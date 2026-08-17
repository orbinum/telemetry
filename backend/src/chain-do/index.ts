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
 *   - `db/chain-history` owns the history table
 *   - this class owns RPC, sockets and the reaper alarm
 *
 * The reaper alarm doubles as the history writer: it already runs once a
 * minute for exactly as long as the chain has nodes, which is the cadence and
 * the lifecycle a history row wants.
 */

import { DurableObject } from "cloudflare:workers";
import { FeedBroadcaster } from "./feed-broadcaster";
import { writeSnapshot } from "../db/chain-history";
import { ChainState, NODE_TIMEOUT_MS } from "../domain/chain-state";
import { FeedHub } from "../feed/hub";
import type { ChainSnapshot } from "../domain/chain-snapshot";
import type { NodeGeo } from "../domain/node-state";
import type { NodeMessage, SystemConnectedMessage } from "../protocol/node";

/** Reaper cadence: sweep expired nodes once a minute while any are alive. */
const REAPER_INTERVAL_MS = 60_000;

export class ChainDO extends DurableObject<CloudflareBindings> {
  private chain?: ChainState;
  private readonly hub = new FeedHub();
  private readonly feed: FeedBroadcaster;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.feed = new FeedBroadcaster(this.hub, () => this.ctx.getWebSockets());
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
    await this.armReaper();
  }

  /**
   * Returns false when the node is unknown — after an eviction the in-memory
   * state is gone while the gateway still holds the socket, so the gateway
   * replays its cached system.connected and retries.
   */
  async nodeMessage(nodeKey: string, msg: NodeMessage): Promise<boolean> {
    if (this.chain === undefined || !this.chain.hasNode(nodeKey)) return false;
    const id = this.chain.applyMessage(nodeKey, msg, Date.now());
    if (id !== undefined) {
      this.hub.markUpdated(id);
      this.feed.schedule(this.chain);
    }
    return true;
  }

  async connectionClosed(nodeKeyPrefix: string): Promise<void> {
    if (this.chain === undefined) return;
    this.hub.markRemoved(this.chain.removeConnection(nodeKeyPrefix));
    this.feed.schedule(this.chain);
  }

  // ─── Reaper ────────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    if (this.chain === undefined) return;
    const now = Date.now();
    this.hub.markRemoved(this.chain.reapExpired(now, NODE_TIMEOUT_MS));
    this.feed.schedule(this.chain);

    // After the sweep, so the row describes the nodes that are still here.
    this.recordHistory(this.chain.snapshot(now));

    // Keep sweeping while the chain has nodes; a dead chain lets the DO idle,
    // which also stops the history for a chain nobody reports to.
    if (this.chain.nodeCount > 0) {
      await this.ctx.storage.setAlarm(now + REAPER_INTERVAL_MS);
    }
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
    this.feed.sendSnapshot(server, this.chain);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Feed sockets are one-way; anything a browser sends is ignored.
  override async webSocketMessage(): Promise<void> {}
  override async webSocketClose(): Promise<void> {}
  override async webSocketError(): Promise<void> {}
}
