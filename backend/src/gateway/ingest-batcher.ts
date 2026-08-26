/**
 * IngestBatcher — accumulates node messages per chain and ships them in one
 * call, recovering the ones a chain no longer recognizes.
 *
 * Exists because every RPC call is billed as its own request while the
 * WebSocket frames feeding them are discounted 20:1 — one call per frame made
 * ingest cost ~20x the sockets carrying it. Nodes report every ~5s and the
 * feed batches at 100 ms anyway, so this window is invisible downstream.
 *
 * Split from `MessageRouter` on purpose: the router decides *whether* a
 * message may be routed and *where*, this decides *when* it travels and how a
 * failed delivery is retried. Mixing them put a timer and an eviction-recovery
 * loop inside the class that holds the ingest policy.
 */

import type { ChainSink, ChainSinkResolver } from "../ports/chains";
import type { NodeConnection } from "./connection";
import type { NodeMessage } from "../protocol/node";

/**
 * How long node messages accumulate before one call carries them to a chain.
 * Matches the feed's own flush window, so batching adds no latency a browser
 * could observe.
 */
export const BATCH_WINDOW_MS = 100;

/** One buffered message, with the connection needed to replay it. */
interface PendingEntry {
  nodeKey: string;
  msg: NodeMessage;
  conn: NodeConnection;
}

interface PendingBatch {
  entries: PendingEntry[];
  timer: ReturnType<typeof setTimeout>;
}

export class IngestBatcher {
  private readonly chainStub: ChainSinkResolver;
  private readonly windowMs: number;
  /** Messages waiting to be shipped, per chain. */
  private readonly pending = new Map<string, PendingBatch>();

  constructor(chainStub: ChainSinkResolver, windowMs: number = BATCH_WINDOW_MS) {
    this.chainStub = chainStub;
    this.windowMs = windowMs;
  }

  /** Buffer a message, arming the window if this is the chain's first entry. */
  add(genesisHash: string, conn: NodeConnection, nodeKey: string, msg: NodeMessage): void {
    const batch = this.pending.get(genesisHash);
    if (batch !== undefined) {
      batch.entries.push({ nodeKey, msg, conn });
      return;
    }

    const timer = setTimeout(() => {
      void this.flush(genesisHash);
    }, this.windowMs);
    this.pending.set(genesisHash, { entries: [{ nodeKey, msg, conn }], timer });
  }

  /**
   * Ship everything buffered right now.
   *
   * Callers use this to close ordering windows: before a `system.connected`,
   * so a queued batch cannot land after the connect that introduces its node,
   * and before a connection is released, so a node's last messages are not
   * applied after the chain was told it left.
   */
  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((genesis) => this.flush(genesis)));
  }

  /** Ship one chain's batch, then recover whatever the chain had forgotten. */
  private async flush(genesisHash: string): Promise<void> {
    const batch = this.pending.get(genesisHash);
    if (batch === undefined) return;
    // Claimed before the first await: a message arriving during the RPC starts
    // the next batch instead of joining one already in flight.
    this.pending.delete(genesisHash);
    clearTimeout(batch.timer);

    const stub = this.chainStub(genesisHash);
    const unknown = await stub.nodeMessages(
      batch.entries.map(({ nodeKey, msg }) => ({ nodeKey, msg })),
    );
    if (unknown.length === 0) return;
    await this.recover(stub, batch.entries, unknown);
  }

  /**
   * Reintroduce nodes a chain no longer knows, then retry just their
   * messages.
   *
   * An unknown key means that object was evicted while this gateway kept the
   * socket. Handled per entry rather than per batch so one forgotten node does
   * not force a whole chain's traffic to be replayed.
   */
  private async recover(
    stub: ChainSink,
    entries: PendingEntry[],
    unknown: string[],
  ): Promise<void> {
    const unknownKeys = new Set(unknown);
    const retry: Array<{ nodeKey: string; msg: NodeMessage }> = [];

    for (const { nodeKey, msg, conn } of entries) {
      if (!unknownKeys.has(nodeKey)) continue;
      // A node with no cached connect cannot be rebuilt; dropping its message
      // is better than sending one the chain would reject again.
      const connected = conn.recallConnected(msg.id);
      if (connected === undefined) continue;
      await stub.nodeConnected(nodeKey, connected, conn.geo);
      retry.push({ nodeKey, msg });
    }

    if (retry.length > 0) await stub.nodeMessages(retry);
  }
}
