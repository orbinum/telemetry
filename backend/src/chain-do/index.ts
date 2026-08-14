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
 *   - this class owns RPC, sockets and the reaper alarm
 */

import { DurableObject } from "cloudflare:workers";
import { FeedBroadcaster } from "./feed-broadcaster";
import { ChainState, NODE_TIMEOUT_MS } from "../domain/chain-state";
import { FeedHub } from "../feed/hub";
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
    this.hub.markRemoved(this.chain.reapExpired(Date.now(), NODE_TIMEOUT_MS));
    this.feed.schedule(this.chain);
    // Keep sweeping while the chain has nodes; a dead chain lets the DO idle.
    if (this.chain.nodeCount > 0) {
      await this.ctx.storage.setAlarm(Date.now() + REAPER_INTERVAL_MS);
    }
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
