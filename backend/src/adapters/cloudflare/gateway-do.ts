/**
 * GatewayDO — owns the node sockets; delegates every decision.
 *
 * A shell: it builds the Cloudflare-shaped pieces a `GatewayService` needs and
 * forwards to it. Everything about what a frame means lives there.
 *
 * Node sockets use the hibernation API. A plain `accept()` bills wall-clock
 * duration for as long as the socket is open, and node sockets are open
 * permanently — with four partitions that is four objects billed around the
 * clock whether or not a frame arrives. Per-socket state therefore lives in
 * the socket's attachment, not in a field here.
 */

import { DurableObject } from "cloudflare:workers";
import { SqlChainDirectory } from "./sql-chain-directory";
import { hibernationAttachment } from "./socket-attachment";
import { GatewayService } from "../../gateway/gateway-service";
import { parseAllowedChains } from "../../config/chains";
import type { NodeConnectionState } from "../../gateway/connection";
import type { ChainDO } from "./chain-do";

export class GatewayDO extends DurableObject<CloudflareBindings> {
  private readonly service: GatewayService;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.service = new GatewayService({
      clock: () => Date.now(),
      directory: new SqlChainDirectory(ctx.storage.sql),
      chainStub: (genesisHash) => this.chainStub(genesisHash),
      attachment: hibernationAttachment<NodeConnectionState>(),
      allowedChains: parseAllowedChains(env),
      // Node keys travel to a chain that pools every partition's connections,
      // so the counter alone is ambiguous — see NodeConnection.id.
      idPrefix: ctx.id.toString(),
      existingSockets: ctx.getWebSockets(),
    });
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/chains") {
      return Response.json(this.service.listChains());
    }
    if (url.pathname === "/submit") {
      return this.acceptNodeSocket(request);
    }
    return new Response("not found", { status: 404 });
  }

  private acceptNodeSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable accept: the object is billed only while handling a frame,
    // not for the lifetime of a socket that never closes.
    this.ctx.acceptWebSocket(server);
    this.service.accept(server, request.headers);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Hibernation handlers ──────────────────────────────────────────────────

  /**
   * The runtime delivers these one at a time per socket, so the frames of one
   * connection cannot interleave — which is the ordering contract in
   * `ports/transport`, and why the hand-rolled promise chain this used to
   * carry could be deleted.
   */
  override webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.service.handleFrame(socket, data);
  }

  override webSocketClose(socket: WebSocket): Promise<void> {
    return this.service.handleClose(socket);
  }

  override webSocketError(socket: WebSocket): Promise<void> {
    return this.service.handleClose(socket);
  }

  private chainStub(genesisHash: string): DurableObjectStub<ChainDO> {
    return this.env.CHAIN.get(this.env.CHAIN.idFromName(genesisHash));
  }
}
