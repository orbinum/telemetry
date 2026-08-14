/**
 * NodeConnection — one node socket and the limits that police it.
 *
 * Owns everything that is per-connection state: the byte budget, the ordered
 * RPC pipeline, and the cached system.connected used to recover from a
 * ChainDO eviction. Keeping this out of the DO leaves the gateway to do only
 * routing.
 */

import { BYTE_BUDGET_BYTES, BYTE_BUDGET_WINDOW_MS } from "../config/limits";
import { RollingTotal } from "../domain/rolling-total";
import type { NodeGeo } from "../domain/node-state";
import type { SystemConnectedMessage } from "../protocol/node";

export class NodeConnection {
  readonly id: number;
  readonly geo?: NodeGeo;
  private readonly socket: WebSocket;
  private readonly bytes = new RollingTotal(BYTE_BUDGET_WINDOW_MS);

  /**
   * Last system.connected per node id. If a ChainDO gets evicted its
   * in-memory state dies while this socket lives on — replaying the cached
   * message rebuilds the node without waiting for a client reconnect.
   */
  private readonly connectedCache = new Map<number, SystemConnectedMessage>();

  /**
   * Serialized RPC pipeline. Calls to a ChainDO must keep their order
   * (system.connected before its intervals), so each frame chains onto the
   * previous one instead of racing it.
   */
  private pipeline: Promise<void> = Promise.resolve();

  private closed = false;

  constructor(id: number, socket: WebSocket, geo: NodeGeo | undefined) {
    this.id = id;
    this.socket = socket;
    this.geo = geo;
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

  /** Queue work that must run after everything already queued. */
  enqueue(work: () => Promise<void>): void {
    this.pipeline = this.pipeline
      .then(work)
      .catch((err: unknown) => console.error("frame routing failed:", err));
  }

  /** Close the socket with an application close code (see config/limits.ts). */
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    console.log(`closing connection ${this.id}: ${reason}`);
    try {
      this.socket.close(code, reason);
    } catch {
      // Already gone; the close/error listener still runs the cleanup.
    }
  }

  /** Mark closed without touching the socket (it closed on its own). */
  markClosed(): void {
    this.closed = true;
  }
}
