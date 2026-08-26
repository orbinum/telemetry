/**
 * ChainDO — one instance per chain (`idFromName(genesisHash)`), owner of that
 * chain's state and of its browser feed sockets.
 *
 * Ingest arrives as RPC from the GatewayDO — no node sockets here. Browser
 * feeds connect via `/feed` using the hibernatable WebSocket API, because
 * they are mostly idle (plan §4.3). The ingest path itself never hibernates:
 * the live state is in memory and nodes reporting every ~5s would keep the
 * object awake anyway.
 *
 * Responsibilities are split deliberately:
 *   - `ChainState` owns the domain (nodes, aggregates, propagation)
 *   - `FeedHub` owns what changed since the last flush
 *   - `FeedBroadcaster` owns snapshots, batching and fanout
 *   - `db/chain-history` and `db/node-sessions` own the history tables
 *   - this class owns RPC, sockets and the reaper alarm
 *
 * The reaper alarm doubles as the history writer: it already runs once a
 * minute for exactly as long as the chain has nodes, which is the cadence and
 * the lifecycle a history row wants.
 */

import { DurableObject } from "cloudflare:workers";
import { FeedBroadcaster } from "./feed-broadcaster";
import { writeSnapshot } from "../db/chain-history";
import {
  closeOrphanSessions,
  closeSessions,
  openSession,
  readLastValidatorAddress,
  recordValidatorAddress,
} from "../db/node-sessions";
import { ChainState, NODE_TIMEOUT_MS } from "../domain/chain-state";
import { FeedHub } from "../feed/hub";
import type { ChainSnapshot } from "../domain/chain-snapshot";
import type { NodeGeo, NodeState } from "../domain/node-state";
import type { NodeEntry } from "../domain/node-table";
import type { NodeMessage, SystemConnectedMessage } from "../protocol/node";

/** Reaper cadence: sweep expired nodes once a minute while any are alive. */
const REAPER_INTERVAL_MS = 60_000;

/**
 * Keepalive for browser feeds: lets a client notice a socket dropped without a
 * FIN, which never fires `close` and leaves the page reporting stale data as
 * live. Answered by the runtime, so a hibernating DO stays hibernating.
 */
const KEEPALIVE = new WebSocketRequestResponsePair("ping", "pong");

export class ChainDO extends DurableObject<CloudflareBindings> {
  private chain?: ChainState;

  /**
   * When this instance started. Sessions still open from before it are the
   * work of an object that died without closing them.
   */
  private readonly startedAt = Date.now();
  /** Whether the one-shot orphan sweep has already run for this instance. */
  private sweptOrphans = false;
  private readonly hub = new FeedHub();
  private readonly feed: FeedBroadcaster;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.feed = new FeedBroadcaster(this.hub, () => this.ctx.getWebSockets());
    this.ctx.setWebSocketAutoResponse(KEEPALIVE);
  }

  // ─── Ingest RPC (called by GatewayDO) ──────────────────────────────────────

  async nodeConnected(
    nodeKey: string,
    msg: SystemConnectedMessage,
    geo: NodeGeo | undefined,
  ): Promise<void> {
    this.chain ??= new ChainState(msg.genesisHash);
    const id = this.chain.addNode(nodeKey, msg, geo, Date.now());
    this.hub.markUpdated(id);
    this.hub.markChainChanged();
    this.feed.schedule(this.chain);
    this.recordSessionStart(this.chain.getById(id));
    this.restoreValidator(id);
    this.sweepOrphanSessions();
    await this.armReaper();
  }

  /**
   * Apply a batch of node messages, returning the node keys this object does
   * not know.
   *
   * Batched rather than one call per message because every RPC is billed as
   * its own request with no discount, while the frames feeding them are
   * discounted 20:1 — one call per frame made ingest cost ~20x the sockets
   * carrying it.
   *
   * An unknown key means this object was evicted while the gateway kept the
   * socket; the gateway replays that node's cached system.connected and
   * retries. Returned per entry rather than as one flag, so one forgotten node
   * does not force a whole chain's batch to be replayed.
   */
  async nodeMessages(batch: Array<{ nodeKey: string; msg: NodeMessage }>): Promise<string[]> {
    if (this.chain === undefined) return batch.map((entry) => entry.nodeKey);

    const now = Date.now();
    const unknown: string[] = [];
    for (const { nodeKey, msg } of batch) {
      if (!this.chain.hasNode(nodeKey)) {
        unknown.push(nodeKey);
        continue;
      }
      this.applyOne(nodeKey, msg, now);
    }

    // Runs even when no message resolved to an id: a block can flip *other*
    // nodes to stale.
    this.markWentStale();
    // Once for the whole batch, not per message — the batch is one update as
    // far as browsers are concerned.
    this.feed.schedule(this.chain);
    return unknown;
  }

  private applyOne(nodeKey: string, msg: NodeMessage, now: number): void {
    if (this.chain === undefined) return;
    // Read before applying: `applyMessage` overwrites the address in place, so
    // afterwards there is nothing left to compare a repeat against.
    const previous =
      msg.msg === "afg.authority_set" ? this.chain.getByKey(nodeKey)?.validator : undefined;
    const id = this.chain.applyMessage(nodeKey, msg, now);
    if (id === undefined) return;

    this.hub.markUpdated(id);
    if (msg.msg === "afg.authority_set" && msg.authorityId !== previous) {
      this.recordValidator(this.chain.getById(id), msg.authorityId);
    }
    // The one session-fixed field that lands after connect, so the next
    // delta has to carry the full row.
    if (msg.msg === "sysinfo.hwbench") this.feed.reintroduce(id);
  }

  async connectionClosed(nodeKeyPrefix: string): Promise<void> {
    if (this.chain === undefined) return;
    const departed = this.chain.takeConnection(nodeKeyPrefix);
    this.hub.markRemoved(departed.map((entry) => entry.id));
    this.feed.schedule(this.chain);
    this.recordSessionEnd(departed, Date.now());
  }

  // ─── Reaper ────────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    if (this.chain === undefined) return;
    const now = Date.now();
    const reaped = this.chain.takeExpired(now, NODE_TIMEOUT_MS);
    this.hub.markRemoved(reaped.map((entry) => entry.id));
    // After the reap, so departed nodes are not swept. The only sweep a chain
    // that stopped producing blocks ever gets.
    this.chain.sweepStale(now);
    this.markWentStale();
    this.feed.schedule(this.chain);

    this.recordSessionEnd(reaped, now);
    // After the sweep, so the row describes the nodes that are still here.
    this.recordHistory(this.chain.snapshot(now));

    // Keep sweeping while the chain has nodes; a dead chain lets the DO idle,
    // which also stops the history for a chain nobody reports to.
    if (this.chain.nodeCount > 0) {
      await this.ctx.storage.setAlarm(now + REAPER_INTERVAL_MS);
    }
  }

  /**
   * Close the sessions a previous instance of this object left open.
   *
   * Runs once, on the first connect after a start. An object that is evicted
   * or redeployed never reaches `connectionClosed`, so its sessions stay open
   * and keep accruing uptime for nodes that left long ago.
   *
   * Deliberately not in the constructor: a Durable Object is constructed for
   * any reason at all, including a request that turns out to touch no
   * sessions, and the sweep is a write. The first `system.connected` is the
   * moment the object is genuinely taking over a chain.
   *
   * Best-effort like the other session writes — a failed sweep costs an
   * inflated uptime figure, not the feed.
   */
  private sweepOrphanSessions(): void {
    const db = this.env.DB;
    if (db === undefined || this.sweptOrphans || this.chain === undefined) return;
    this.sweptOrphans = true;

    const genesisHash = this.chain.genesisHash;
    // Live rows are identified by connected_at, which this object knows for
    // every node it currently holds.
    const live = this.chain.list().map(({ node }) => node.connectedAt);
    this.ctx.waitUntil(
      closeOrphanSessions(db, genesisHash, live, this.startedAt)
        .then((closed) => {
          if (closed > 0) console.log(`closed ${closed} orphan sessions for ${genesisHash}`);
        })
        .catch((error: unknown) => {
          console.error("orphan session sweep failed", error);
        }),
    );
  }

  /**
   * Persist one minute of history, out of band.
   *
   * `waitUntil`, never `await`: history is best-effort and live telemetry is
   * not, so a slow or overloaded D1 must not delay the reaper or the feed
   * flush behind it. A failed write costs one point in a chart; a stalled
   * alarm costs the node list.
   */
  private recordHistory(snapshot: ChainSnapshot): void {
    const db = this.env.DB;
    if (db === undefined) return; // no binding (dev, tests) → no history
    this.ctx.waitUntil(
      writeSnapshot(db, snapshot).catch((error: unknown) => {
        console.error("chain history write failed", error);
      }),
    );
  }

  /**
   * Persist the address a node just announced. Best-effort, like the session
   * writes: losing it costs a column in the UI, not the feed.
   */
  private recordValidator(node: NodeState | undefined, address: string): void {
    const db = this.env.DB;
    if (db === undefined || node === undefined || this.chain === undefined) return;
    const { networkId } = node.details;
    if (networkId === undefined) return;
    this.ctx.waitUntil(
      recordValidatorAddress(
        db,
        this.chain.genesisHash,
        networkId,
        node.connectedAt,
        address,
      ).catch((error: unknown) => {
        console.error("validator address write failed", error);
      }),
    );
  }

  /**
   * Seed a node's address from the last session that had one.
   *
   * This is what makes the Address column survive a verbosity-0 network: the
   * node never sends `afg.authority_set` at all, so without the lookup the
   * column is empty for every validator, forever. It also covers an eviction
   * or a gateway redeploy, where the message did arrive but the memory holding
   * it is gone.
   *
   * Only fills a gap — a node that already reported an address this session
   * keeps it, so a stale row can never overwrite live data.
   */
  private restoreValidator(id: number): void {
    const db = this.env.DB;
    if (db === undefined || this.chain === undefined) return;
    const node = this.chain.getById(id);
    const networkId = node?.details.networkId;
    if (node === undefined || networkId === undefined || node.validator !== undefined) return;

    const genesisHash = this.chain.genesisHash;
    this.ctx.waitUntil(
      readLastValidatorAddress(db, genesisHash, networkId)
        .then((address) => {
          // Re-check: afg may have landed while D1 was being read, and the
          // live message is the more current of the two.
          if (address === undefined || node.validator !== undefined) return;
          node.setValidatorAddress(address);
          this.hub.markUpdated(id);
          if (this.chain !== undefined) this.feed.schedule(this.chain);
        })
        .catch((error: unknown) => {
          console.error("validator address read failed", error);
        }),
    );
  }

  /**
   * Ship the stale flags the sweep just flipped. Removed ids are skipped:
   * marking one updated would resurrect it in the batch the hub is assembling.
   */
  private markWentStale(): void {
    if (this.chain === undefined) return;
    for (const id of this.chain.drainWentStale()) {
      if (this.chain.getById(id) !== undefined) this.hub.markUpdated(id);
    }
  }

  /** Open a session for a node that just announced itself. Best-effort. */
  private recordSessionStart(node: NodeState | undefined): void {
    const db = this.env.DB;
    if (db === undefined || node === undefined || this.chain === undefined) return;
    this.ctx.waitUntil(
      openSession(db, this.chain.genesisHash, node).catch((error: unknown) => {
        console.error("session open failed", error);
      }),
    );
  }

  /**
   * Close the sessions of nodes that just left — the only moment their uptime
   * becomes a fact rather than an open interval.
   *
   * One batched statement for the whole departure: a reaper sweeping a large
   * chain would otherwise issue a D1 call per node, which is how a single
   * invocation runs out of queries.
   */
  private recordSessionEnd(departed: NodeEntry[], now: number): void {
    const db = this.env.DB;
    if (db === undefined || this.chain === undefined || departed.length === 0) return;
    const sessions = departed.map((entry) => ({
      networkId: entry.node.details.networkId,
      connectedAt: entry.node.connectedAt,
    }));
    this.ctx.waitUntil(
      closeSessions(db, this.chain.genesisHash, sessions, now).catch((error: unknown) => {
        console.error("session close failed", error);
      }),
    );
  }

  private async armReaper(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + REAPER_INTERVAL_MS);
    }
  }

  // ─── Browser feed ──────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/feed") {
      return new Response("not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Hibernatable accept: feed sockets survive eviction without billing for
    // idle time, and the socket list lives in ctx.getWebSockets().
    this.ctx.acceptWebSocket(server);
    this.feed.sendSnapshot(server, this.chain, Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }

  // Feed sockets carry no browser→server data: "ping" is auto-answered by the
  // runtime before reaching here, and anything else is ignored.
  override async webSocketMessage(): Promise<void> {}
  override async webSocketClose(): Promise<void> {}
  override async webSocketError(): Promise<void> {}
}
