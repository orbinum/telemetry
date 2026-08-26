/**
 * GatewayDO — owns the node sockets; delegates every decision.
 *
 * Exists because the genesis hash is only known after the first
 * system.connected, which arrives *after* the upgrade: someone has to hold
 * the socket, parse, and only then know which chain it belongs to (plan §3.2
 * — the same role as the reference's telemetry_shard). Partitioned by
 * hash(clientIp) % 4 in the Worker.
 *
 * Responsibilities are split deliberately:
 *   - `NodeConnection` owns per-socket state and the byte budget
 *   - `MessageRouter` owns the ingest policy (allowlist, node cap, routing)
 *   - the chain directory owns what the picker needs after a deploy
 *   - this class owns only sockets and their lifecycle
 *
 * Node sockets use the hibernation API. A plain `accept()` bills wall-clock
 * duration for as long as the socket is open, and node sockets are open
 * permanently — with four partitions that is four objects billed around the
 * clock whether or not a frame arrives. Per-socket state therefore lives in
 * the socket's attachment (see `NodeConnection`), not in a field here.
 */

import { DurableObject } from "cloudflare:workers";
import { SqlChainDirectory } from "../adapters/cloudflare/sql-chain-directory";
import { NodeConnection } from "./connection";
import { IngestBatcher } from "./ingest-batcher";
import { frameToText } from "./frames";
import { MessageRouter } from "./message-router";
import { RouteTable } from "./route-table";
import type { ChainDirectoryStore } from "../ports/directory";
import { parseAllowedChains } from "../config/chains";
import { CLOSE_BYTE_BUDGET } from "../config/limits";
import { parseGeoHeader } from "../middleware/geo";
import { parseNodeMessage, peekMessageName } from "../protocol/node";
import type { ChainDO } from "../chain-do";

export class GatewayDO extends DurableObject<CloudflareBindings> {
  private readonly routes = new RouteTable();
  private readonly directory: ChainDirectoryStore;
  private readonly batcher: IngestBatcher;
  private readonly router: MessageRouter;
  private nextConnId = 1;

  /**
   * This partition's half of a connection id. Node keys reach a ChainDO that
   * pools every gateway's connections, so the counter alone is ambiguous —
   * see NodeConnection.id.
   */
  private readonly idPrefix: string;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.directory = new SqlChainDirectory(ctx.storage.sql);
    this.idPrefix = ctx.id.toString();

    // Sockets outlive the object under hibernation, so a counter restarting at
    // 1 would hand a new connection the id of one that is still streaming.
    // Both build the same node keys, and the ChainDO pools them into one
    // table — the older node would be silently replaced. Resume past the
    // highest id still connected instead.
    this.nextConnId = highestConnId(ctx.getWebSockets(), this.idPrefix) + 1;

    const allowedChains = parseAllowedChains(env);
    if (allowedChains.size === 0) {
      console.error(
        "no genesis allowlist configured (TELEMETRY_TESTNET_GENESIS / " +
          "TELEMETRY_MAINNET_GENESIS / TELEMETRY_CHAINS) — rejecting ALL nodes",
      );
    }

    this.batcher = new IngestBatcher((genesisHash) => this.chainStub(genesisHash));
    this.router = new MessageRouter({
      routes: this.routes,
      directory: this.directory,
      allowedChains,
      chainStub: (genesisHash) => this.chainStub(genesisHash),
      batcher: this.batcher,
      now: () => Date.now(),
    });
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/chains") {
      const now = Date.now();
      // Pruning on read keeps the table bounded without an alarm of its own;
      // the directory is only read when a browser opens the picker.
      this.directory.prune(now);
      return Response.json(this.directory.list(now));
    }
    if (url.pathname === "/submit") {
      return this.acceptNodeSocket(request);
    }
    return new Response("not found", { status: 404 });
  }

  // ─── Socket lifecycle ──────────────────────────────────────────────────────

  private acceptNodeSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable accept: the object is billed only while handling a frame,
    // not for the lifetime of a socket that never closes.
    this.ctx.acceptWebSocket(server);
    const conn = new NodeConnection(
      `${this.idPrefix}-${this.nextConnId++}`,
      server,
      parseGeoHeader(request.headers),
    );
    conn.persist();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Hibernation handlers ──────────────────────────────────────────────────

  /**
   * The runtime delivers these one at a time per socket, so the frames of one
   * connection cannot interleave — which is what preserves the ordering the
   * ChainDO needs (`system.connected` before its intervals) without the
   * hand-rolled promise chain this used to carry.
   */
  override async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const conn = NodeConnection.fromSocket(socket);
    // No attachment means a socket this object never accepted as a node feed.
    if (conn === undefined) return;

    const text = frameToText(data);
    if (text === null) return;
    await this.onFrame(conn, typeof text === "string" ? text : await text);

    // One place decides what a handled frame leaves behind, so no branch of
    // `onFrame` can forget to save the budget it just charged.
    conn.persist();
    if (conn.isClosed) await this.dropConnection(conn);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.onSocketGone(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.onSocketGone(socket);
  }

  private async onSocketGone(socket: WebSocket): Promise<void> {
    const conn = NodeConnection.fromSocket(socket);
    if (conn === undefined) return;
    conn.markClosed();
    await this.dropConnection(conn);
  }

  /**
   * Forget a connection, shipping whatever it still had buffered.
   *
   * The flush comes first: a batch holding this socket's last messages would
   * otherwise be applied *after* the chain was told the node left, resurrecting
   * it until the reaper swept it a minute later.
   */
  private async dropConnection(conn: NodeConnection): Promise<void> {
    await this.batcher.flushAll();
    this.releaseConnection(conn);
  }

  /**
   * Budget first, then parse, then route — in that order, always.
   *
   * Leaves persistence and teardown to the caller; every exit here is just
   * "this frame is done".
   */
  private async onFrame(conn: NodeConnection, raw: string): Promise<void> {
    if (conn.isClosed) return;

    if (!conn.chargeBytes(raw.length, Date.now())) {
      conn.close(CLOSE_BYTE_BUDGET, "byte budget exceeded");
      return;
    }

    const msg = parseNodeMessage(raw);
    if (msg === null) {
      // Unknown variants are logged, not silently dropped (plan Fase 2) —
      // they are the early warning that the client protocol moved under us.
      const name = peekMessageName(raw);
      if (name !== null) console.log("debug: unknown node message variant:", name);
      return;
    }

    await this.router.route(conn, msg);
  }

  /** Forget a connection's nodes, telling every chain it fed. */
  private releaseConnection(conn: NodeConnection): void {
    for (const genesisHash of this.routes.dropConnection(conn.id)) {
      void this.chainStub(genesisHash)
        .connectionClosed(conn.nodeKeyPrefix)
        .catch((err: unknown) => console.error("connection cleanup failed:", err));
    }
  }

  private chainStub(genesisHash: string): DurableObjectStub<ChainDO> {
    return this.env.CHAIN.get(this.env.CHAIN.idFromName(genesisHash));
  }
}

/**
 * The largest connection number among sockets already attached to this
 * partition. Ids look like `<doId>-<n>`; anything unparseable is ignored
 * rather than trusted, since the attachment is only as good as the last write.
 */
function highestConnId(sockets: WebSocket[], idPrefix: string): number {
  let highest = 0;
  for (const socket of sockets) {
    const conn = NodeConnection.fromSocket(socket);
    if (conn === undefined || !conn.id.startsWith(`${idPrefix}-`)) continue;
    const n = Number(conn.id.slice(idPrefix.length + 1));
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return highest;
}
