/**
 * MessageRouter — decides what happens to one parsed node message.
 *
 * This is where the ingest policy lives: which chains are accepted, how many
 * nodes a socket may claim, which ChainDO receives what, and how long a chain
 * stays listed in the directory. The DO around it only owns sockets;
 * everything with a rule in it is here, which is also what makes the rules
 * testable without a WebSocket.
 */

import { isChainAllowed } from "../config/chains";
import {
  CLOSE_CHAIN_NOT_ALLOWED,
  CLOSE_TOO_MANY_NODES,
  MAX_NODES_PER_CONNECTION,
} from "../config/limits";
import type { ChainDirectoryStore } from "../ports/directory";
import type { IngestBatcher } from "./ingest-batcher";
import type { NodeConnection } from "./connection";
import type { RouteTable } from "./route-table";
import type { ChainDO } from "../chain-do";
import type { NodeMessage } from "../protocol/node";

/** Resolves the stub for a chain — injected so tests need no DO namespace. */
export type ChainStubResolver = (genesisHash: string) => DurableObjectStub<ChainDO>;

export interface MessageRouterDeps {
  routes: RouteTable;
  directory: ChainDirectoryStore;
  allowedChains: Set<string>;
  chainStub: ChainStubResolver;
  batcher: IngestBatcher;
  now: () => number;
}

/**
 * How often a chain's activity stamp is refreshed. Every routed message
 * would mean a SQLite write per frame — ~1000/s at 500 nodes — to move a
 * timestamp only read by a directory whose TTL is minutes wide.
 */
const TOUCH_INTERVAL_MS = 30_000;

export class MessageRouter {
  private readonly deps: MessageRouterDeps;
  /** Last time each chain's directory row was refreshed. */
  private readonly lastTouched = new Map<string, number>();

  constructor(deps: MessageRouterDeps) {
    this.deps = deps;
  }

  /** Route one message. Closes the connection when it breaks a limit. */
  async route(conn: NodeConnection, msg: NodeMessage): Promise<void> {
    if (msg.msg === "system.connected") {
      await this.deps.batcher.flushAll();
      await this.routeConnected(conn, msg);
      return;
    }
    this.routeNodeMessage(conn, msg);
  }

  private async routeConnected(
    conn: NodeConnection,
    msg: Extract<NodeMessage, { msg: "system.connected" }>,
  ): Promise<void> {
    const { routes, directory, allowedChains, chainStub, now } = this.deps;

    // Reject chains we don't serve before allocating anything for them.
    if (!isChainAllowed(allowedChains, msg.genesisHash)) {
      conn.close(CLOSE_CHAIN_NOT_ALLOWED, "chain not allowed");
      return;
    }

    // Cap node ids per socket: one connection must not be able to fill a DO's
    // memory with claimed nodes.
    const isNewNode = routes.resolve(conn.id, msg.id) === undefined;
    if (isNewNode && routes.nodeCount(conn.id) >= MAX_NODES_PER_CONNECTION) {
      conn.close(CLOSE_TOO_MANY_NODES, "too many nodes on one connection");
      return;
    }

    routes.register(conn.id, msg.id, msg.genesisHash);
    conn.rememberConnected(msg);
    directory.record(msg.genesisHash, msg.node.chain, now());
    this.lastTouched.set(msg.genesisHash, now());
    await chainStub(msg.genesisHash).nodeConnected(conn.nodeKey(msg.id), msg, conn.geo);
  }

  /**
   * Keep a chain's directory entry alive while its nodes keep reporting.
   *
   * A node that connected hours ago and has streamed ever since is the most
   * current chain there is, so its entry must not age out from under it. The
   * write is throttled because the stamp only feeds a TTL measured in
   * minutes — refreshing it per frame would be a SQLite write per message.
   */
  private touchChain(genesisHash: string): void {
    const now = this.deps.now();
    const last = this.lastTouched.get(genesisHash) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouched.set(genesisHash, now);
    this.deps.directory.touch(genesisHash, now);
  }

  private routeNodeMessage(conn: NodeConnection, msg: NodeMessage): void {
    const genesisHash = this.deps.routes.resolve(conn.id, msg.id);
    // Messages before system.connected can't be routed — drop them.
    if (genesisHash === undefined) return;

    this.touchChain(genesisHash);
    this.deps.batcher.add(genesisHash, conn, conn.nodeKey(msg.id), msg);
  }
}
