/**
 * ChainDO — one instance per chain (`idFromName(genesisHash)`), owner of that
 * chain's state and of its browser feed sockets.
 *
 * A shell: it builds the Cloudflare-shaped pieces a `ChainService` needs and
 * forwards to it. Everything the chain actually does lives there, which is
 * what lets the reaper's ordering and the eviction recovery be tested without
 * a Durable Object to construct.
 *
 * Ingest arrives as RPC from the GatewayDO — no node sockets here. Browser
 * feeds connect via `/feed` using the hibernatable WebSocket API, because they
 * are mostly idle (plan §4.3). The ingest path itself never hibernates: the
 * live state is in memory and nodes reporting every ~5s would keep the object
 * awake anyway.
 */

import { DurableObject } from "cloudflare:workers";
import { D1HistoryRepository } from "../adapters/cloudflare/d1-history-repository";
import { D1SessionRepository } from "../adapters/cloudflare/d1-session-repository";
import { durableObjectAlarms, durableObjectDeferred } from "../adapters/cloudflare/do-runtime";
import { ChainService } from "../chain/chain-service";
import type { NodeGeo } from "../domain/node-state";
import type { NodeMessage, SystemConnectedMessage } from "../protocol/node";

/**
 * Keepalive for browser feeds: lets a client notice a socket dropped without a
 * FIN, which never fires `close` and leaves the page reporting stale data as
 * live. Answered by the runtime, so a hibernating DO stays hibernating.
 */
const KEEPALIVE = new WebSocketRequestResponsePair("ping", "pong");

export class ChainDO extends DurableObject<CloudflareBindings> {
  private readonly service: ChainService;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.service = new ChainService({
      clock: () => Date.now(),
      deferred: durableObjectDeferred(ctx),
      alarms: durableObjectAlarms(ctx),
      sockets: () => this.ctx.getWebSockets(),
      history: env.DB === undefined ? undefined : new D1HistoryRepository(env.DB),
      sessions: env.DB === undefined ? undefined : new D1SessionRepository(env.DB),
    });
    this.ctx.setWebSocketAutoResponse(KEEPALIVE);
  }

  // ─── Ingest RPC (called by GatewayDO) ──────────────────────────────────────

  nodeConnected(
    nodeKey: string,
    msg: SystemConnectedMessage,
    geo: NodeGeo | undefined,
  ): Promise<void> {
    return this.service.nodeConnected(nodeKey, msg, geo);
  }

  nodeMessages(batch: Array<{ nodeKey: string; msg: NodeMessage }>): Promise<string[]> {
    return this.service.nodeMessages(batch);
  }

  connectionClosed(nodeKeyPrefix: string): Promise<void> {
    return this.service.connectionClosed(nodeKeyPrefix);
  }

  // ─── Reaper ────────────────────────────────────────────────────────────────

  override alarm(): Promise<void> {
    return this.service.alarm();
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
    this.service.greet(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Feed sockets carry no browser→server data: "ping" is auto-answered by the
  // runtime before reaching here, and anything else is ignored.
  override async webSocketMessage(): Promise<void> {}
  override async webSocketClose(): Promise<void> {}
  override async webSocketError(): Promise<void> {}
}
