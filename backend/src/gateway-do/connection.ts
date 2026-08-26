/**
 * NodeConnection — one node socket and the limits that police it.
 *
 * Owns everything that is per-connection state: the byte budget and the cached
 * system.connected used to recover from a ChainDO eviction. Keeping this out of
 * the DO leaves the gateway to do only routing.
 *
 * The state travels through a `SocketAttachment` rather than a field on the
 * object holding the socket, because that object can be evicted while the
 * socket stays open, and anything held only in memory would come back empty.
 * That matters most for the byte budget — a client able to drop the object at
 * will would otherwise reset its own rate limit.
 */

import { BYTE_BUDGET_BYTES, BYTE_BUDGET_WINDOW_MS } from "../config/limits";
import { RollingTotal } from "../domain/rolling-total";
import type { RollingTotalState } from "../domain/rolling-total";
import type { NodeGeo } from "../domain/node-state";
import type { OutboundSocket, SocketAttachment } from "../ports/transport";
import type { SystemConnectedMessage } from "../protocol/node";

/** What survives an eviction, as stored in the socket's attachment. */
export interface NodeConnectionState {
  id: string;
  geo?: NodeGeo;
  bytes: RollingTotalState;
  /** Cached system.connected per node id, as entries (a Map is not JSON). */
  connected: Array<[number, SystemConnectedMessage]>;
}

export class NodeConnection {
  /**
   * Identifies this connection *across gateways*, not just within one.
   *
   * Node keys are built from it and travel to a ChainDO, which pools the
   * connections of all four gateway partitions into one table. A per-gateway
   * counter therefore collides: partition 0's first socket and partition 1's
   * first socket both claim `1:1`, and whichever reports last silently
   * replaces the other — the chain shows four nodes out of six, and fixing one
   * node's config makes a different one vanish.
   */
  readonly id: string;
  readonly geo?: NodeGeo;
  private readonly socket: OutboundSocket;
  private readonly bytes = new RollingTotal(BYTE_BUDGET_WINDOW_MS);

  /**
   * Last system.connected per node id. If a ChainDO gets evicted its
   * in-memory state dies while this socket lives on — replaying the cached
   * message rebuilds the node without waiting for a client reconnect.
   */
  private readonly connectedCache = new Map<number, SystemConnectedMessage>();

  private closed = false;

  constructor(id: string, socket: OutboundSocket, geo: NodeGeo | undefined) {
    this.id = id;
    this.socket = socket;
    this.geo = geo;
  }

  // ─── Attachment ────────────────────────────────────────────────────────────

  /**
   * Rebuild from the socket's attachment after an eviction. Returns undefined
   * for a socket the gateway never attached state to, which is the one case
   * that must not be treated as a live connection.
   */
  static fromSocket(
    socket: OutboundSocket,
    attachment: SocketAttachment<NodeConnectionState>,
  ): NodeConnection | undefined {
    const state = attachment.read(socket);
    if (state === undefined || typeof state !== "object") return undefined;

    const conn = new NodeConnection(state.id, socket, state.geo);
    conn.bytes.restore(state.bytes);
    for (const [id, msg] of state.connected) conn.connectedCache.set(id, msg);
    return conn;
  }

  /**
   * Persist this connection's state onto the socket.
   *
   * Called after every mutation rather than on a timer: an eviction is not
   * announced, so state that is not written by the end of the handler is state
   * that can be lost.
   */
  persist(attachment: SocketAttachment<NodeConnectionState>): void {
    attachment.write(this.socket, {
      id: this.id,
      geo: this.geo,
      bytes: this.bytes.toJSON(),
      connected: [...this.connectedCache],
    });
  }

  /** Key that identifies one node: unique per (connection, envelope id). */
  nodeKey(messageId: number): string {
    return `${this.id}:${messageId}`;
  }

  /** Prefix matching every node key of this connection. */
  get nodeKeyPrefix(): string {
    return `${this.id}:`;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ─── Budget ────────────────────────────────────────────────────────────────

  /**
   * Charge a frame against the byte budget. Returns false when the budget is
   * blown — the only defence against a client flooding an already-open
   * socket, since frames on an established connection never reach the edge
   * rate limiter.
   */
  chargeBytes(byteLength: number, now: number): boolean {
    return this.bytes.push(byteLength, now) <= BYTE_BUDGET_BYTES;
  }

  // ─── Connected cache ───────────────────────────────────────────────────────

  rememberConnected(msg: SystemConnectedMessage): void {
    this.connectedCache.set(msg.id, msg);
  }

  recallConnected(messageId: number): SystemConnectedMessage | undefined {
    return this.connectedCache.get(messageId);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Close the socket with an application close code (see config/limits.ts). */
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    console.log(`closing connection ${this.id}: ${reason}`);
    try {
      this.socket.close(code, reason);
    } catch {
      // Already gone; the close handler still runs the cleanup.
    }
  }

  /** Mark closed without touching the socket (it closed on its own). */
  markClosed(): void {
    this.closed = true;
  }
}
