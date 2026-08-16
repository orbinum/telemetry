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
 *   - `ChainDirectory` owns the SQLite table
 *   - this class owns only sockets and their lifecycle
 */

import { DurableObject } from "cloudflare:workers";
import { ChainDirectory } from "./chain-directory";
import { NodeConnection } from "./connection";
import { frameToText } from "./frames";
import { MessageRouter } from "./message-router";
import { RouteTable } from "./route-table";
import { parseAllowedChains } from "../config/chains";
import { CLOSE_BYTE_BUDGET } from "../config/limits";
import { parseGeoHeader } from "../middleware/geo";
import { parseNodeMessage, peekMessageName } from "../protocol/node";
import type { ChainDO } from "../chain-do";

export class GatewayDO extends DurableObject<CloudflareBindings> {
  private readonly routes = new RouteTable();
  private readonly directory: ChainDirectory;
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
    this.directory = new ChainDirectory(ctx.storage.sql);
    this.idPrefix = ctx.id.toString();

    const allowedChains = parseAllowedChains(env);
    if (allowedChains.size === 0) {
      console.error(
        "no genesis allowlist configured (TELEMETRY_TESTNET_GENESIS / " +
          "TELEMETRY_MAINNET_GENESIS / TELEMETRY_CHAINS) — rejecting ALL nodes",
      );
    }

    this.router = new MessageRouter({
      routes: this.routes,
      directory: this.directory,
      allowedChains,
      chainStub: (genesisHash) => this.chainStub(genesisHash),
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

    server.accept();
    const conn = new NodeConnection(
      `${this.idPrefix}-${this.nextConnId++}`,
      server,
      parseGeoHeader(request.headers),
    );

    server.addEventListener("message", (event) => {
      const text = frameToText(event.data);
      if (text === null) return;
      if (typeof text === "string") {
        this.onFrame(conn, text);
      } else {
        void text.then((raw) => this.onFrame(conn, raw));
      }
    });

    const drop = () => {
      conn.markClosed();
      this.releaseConnection(conn);
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Budget first, then parse, then route — in that order, always. */
  private onFrame(conn: NodeConnection, raw: string): void {
    if (conn.isClosed) return;

    if (!conn.chargeBytes(raw.length, Date.now())) {
      conn.close(CLOSE_BYTE_BUDGET, "byte budget exceeded");
      this.releaseConnection(conn);
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

    conn.enqueue(async () => {
      await this.router.route(conn, msg);
      if (conn.isClosed) this.releaseConnection(conn);
    });
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
