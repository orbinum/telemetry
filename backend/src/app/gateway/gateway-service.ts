/**
 * GatewayService — the node sockets and what happens to their frames.
 *
 * Exists because a node's chain is only known after the first
 * `system.connected`, which arrives *after* the upgrade: something has to hold
 * the socket, parse, and only then know where the frames belong. That is a
 * property of the telemetry protocol, not of any host.
 *
 * Responsibilities are split deliberately:
 *   - `NodeConnection` owns per-socket state and the byte budget
 *   - `MessageRouter` owns the ingest policy (allowlist, node cap, routing)
 *   - `IngestBatcher` owns when frames travel and how a failed delivery retries
 *   - the chain directory owns what the picker needs after a deploy
 *   - this class owns the sockets and their lifecycle
 */

import { NodeConnection } from "./connection";
import { frameToText } from "./frames";
import { IngestBatcher } from "./ingest-batcher";
import { MessageRouter } from "./message-router";
import { RouteTable } from "./route-table";
import { CLOSE_BYTE_BUDGET } from "../../core/config/limits";
import { parseGeoHeader } from "../../core/protocol/geo-header";
import { parseNodeMessage, peekMessageName } from "../../core/protocol/node";
import type { NodeConnectionState } from "./connection";
import type { ChainSinkResolver } from "../ports/chains";
import type { ChainDirectoryStore } from "../ports/directory";
import type { Clock } from "../ports/runtime";
import type { OutboundSocket, SocketAttachment } from "../ports/transport";

export interface GatewayServiceDeps {
  clock: Clock;
  directory: ChainDirectoryStore;
  chainStub: ChainSinkResolver;
  /** Where per-socket state lives while this instance is not resident. */
  attachment: SocketAttachment<NodeConnectionState>;
  /** Chains this gateway accepts; an empty set rejects every node. */
  allowedChains: Set<string>;
  /**
   * This instance's half of a connection id, and the sockets it already holds.
   *
   * Node keys built from the counter reach a chain that pools every gateway's
   * connections, so a counter restarting at 1 would hand a new socket the id
   * of one still streaming — and the older node would be silently replaced.
   * Resuming past the highest id already connected is what prevents that.
   */
  idPrefix: string;
  existingSockets: OutboundSocket[];
}

export class GatewayService {
  private readonly deps: GatewayServiceDeps;
  private readonly routes = new RouteTable();
  private readonly batcher: IngestBatcher;
  private readonly router: MessageRouter;
  private nextConnId: number;

  constructor(deps: GatewayServiceDeps) {
    this.deps = deps;
    this.nextConnId = highestConnId(deps.existingSockets, deps.idPrefix, deps.attachment) + 1;

    if (deps.allowedChains.size === 0) {
      console.error(
        "no genesis allowlist configured (TELEMETRY_TESTNET_GENESIS / " +
          "TELEMETRY_MAINNET_GENESIS / TELEMETRY_CHAINS) — rejecting ALL nodes",
      );
    }

    this.batcher = new IngestBatcher(deps.chainStub);
    this.router = new MessageRouter({
      routes: this.routes,
      directory: deps.directory,
      allowedChains: deps.allowedChains,
      chainStub: deps.chainStub,
      batcher: this.batcher,
      now: deps.clock,
    });
  }

  // ─── Directory ─────────────────────────────────────────────────────────────

  /**
   * The chains this gateway has seen recently.
   *
   * Pruning on read keeps the store bounded without a timer of its own; the
   * directory is only read when a browser opens the picker.
   */
  listChains(): ReturnType<ChainDirectoryStore["list"]> {
    const now = this.deps.clock();
    this.deps.directory.prune(now);
    return this.deps.directory.list(now);
  }

  // ─── Socket lifecycle ──────────────────────────────────────────────────────

  /** Take ownership of a newly accepted node socket. */
  accept(socket: OutboundSocket, headers: Headers): void {
    const conn = new NodeConnection(
      `${this.deps.idPrefix}-${this.nextConnId++}`,
      socket,
      parseGeoHeader(headers),
    );
    conn.persist(this.deps.attachment);
  }

  /**
   * Handle one frame.
   *
   * The caller must not deliver another frame for this socket until the
   * returned promise settles — see the ordering contract in `ports/transport`.
   */
  async handleFrame(socket: OutboundSocket, data: string | ArrayBuffer): Promise<void> {
    const conn = NodeConnection.fromSocket(socket, this.deps.attachment);
    // No attachment means a socket this instance never accepted as a node feed.
    if (conn === undefined) return;

    const text = frameToText(data);
    if (text === null) return;
    await this.onFrame(conn, typeof text === "string" ? text : await text);

    // One place decides what a handled frame leaves behind, so no branch of
    // `onFrame` can forget to save the budget it just charged.
    conn.persist(this.deps.attachment);
    if (conn.isClosed) await this.dropConnection(conn);
  }

  /** The socket went away on its own. */
  async handleClose(socket: OutboundSocket): Promise<void> {
    const conn = NodeConnection.fromSocket(socket, this.deps.attachment);
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

    if (!conn.chargeBytes(raw.length, this.deps.clock())) {
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
      void this.deps
        .chainStub(genesisHash)
        .connectionClosed(conn.nodeKeyPrefix)
        .catch((err: unknown) => console.error("connection cleanup failed:", err));
    }
  }
}

/**
 * The largest connection number among sockets already held. Ids look like
 * `<prefix>-<n>`; anything unparseable is ignored rather than trusted, since
 * the attachment is only as good as the last write.
 */
function highestConnId(
  sockets: OutboundSocket[],
  idPrefix: string,
  attachment: SocketAttachment<NodeConnectionState>,
): number {
  let highest = 0;
  for (const socket of sockets) {
    const conn = NodeConnection.fromSocket(socket, attachment);
    if (conn === undefined || !conn.id.startsWith(`${idPrefix}-`)) continue;
    const n = Number(conn.id.slice(idPrefix.length + 1));
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return highest;
}
