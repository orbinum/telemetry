/**
 * ChainState — the aggregates of one chain, over its node table.
 *
 * Faithful port of the aggregation in telemetry_core/src/state/chain.rs:
 * best/finalized tracking, block-time averages, propagation (the first node
 * to report a height gets 0, the rest get now − that first report), and the
 * 2-minute stale sweep.
 *
 * Node identity and lifecycle live in `NodeTable`; this class only reads the
 * table and computes over it. Pure domain: no sockets, no clock — time is a
 * parameter, which is what makes propagation and staleness testable.
 */

import { buildSnapshot } from "./chain-snapshot";
import { NodeTable } from "./node-table";
import type { ChainSnapshot } from "./chain-snapshot";
import type { NodeEntry } from "./node-table";
import type { NodeGeo, NodeState } from "./node-state";
import type { BlockRef, NodeMessage, SystemConnectedMessage } from "../protocol/node";

/** 2 minutes without a new best block → stale sweep (chain.rs STALE_TIMEOUT). */
export const STALE_TIMEOUT_MS = 2 * 60 * 1000;

/** 60s without reporting and a node is reaped from the table (plan §6). */
export const NODE_TIMEOUT_MS = 60_000;

/** Block-time samples kept for the average (reference: NumStats over 50). */
const BLOCK_TIME_WINDOW = 50;

export class ChainState {
  readonly genesisHash: string;
  private readonly table = new NodeTable();

  best?: BlockRef;
  finalized?: BlockRef;
  averageBlockTime?: number;

  /** Wall-clock ms when the current best height was first reported. */
  private bestTimestamp?: number;
  private blockTimes: number[] = [];

  constructor(genesisHash: string) {
    this.genesisHash = genesisHash;
  }

  // ─── Ingest ────────────────────────────────────────────────────────────────

  /** Register a node; returns its feed id (stable across re-announcements). */
  addNode(key: string, msg: SystemConnectedMessage, geo: NodeGeo | undefined, now: number): number {
    return this.table.add(key, msg, geo, now);
  }

  /**
   * Apply one parsed message to the node it belongs to.
   * Returns the node's feed id, or undefined when there was no such node.
   */
  applyMessage(key: string, msg: NodeMessage, now: number): number | undefined {
    const node = this.table.get(key);
    // Messages before system.connected have nothing to attach to — drop them.
    if (node === undefined) return undefined;
    node.lastSeen = now;

    switch (msg.msg) {
      case "system.interval":
        node.updateInterval(msg, now);
        if (msg.block !== undefined) this.handleBlock(node, msg.block, now);
        if (msg.finalizedHash !== undefined && msg.finalizedHeight !== undefined) {
          this.handleFinalized(node, { hash: msg.finalizedHash, height: msg.finalizedHeight });
        }
        break;
      case "block.import":
        this.handleBlock(node, msg.block, now);
        break;
      case "notify.finalized":
        this.handleFinalized(node, msg.block);
        break;
      case "afg.authority_set":
        node.setValidatorAddress(msg.authorityId);
        break;
      case "sysinfo.hwbench":
        node.updateHwBench(msg);
        break;
      case "system.connected":
        // A repeat replaces the node outright, keeping its feed id.
        this.table.add(key, msg, node.geo, now);
        break;
    }
    return this.table.idOf(key);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Drop every node of a closing connection; returns the feed ids that left. */
  removeConnection(prefix: string): number[] {
    return this.table.removeByPrefix(prefix);
  }

  /** Drop nodes that stopped reporting; returns the feed ids that left. */
  reapExpired(now: number, timeoutMs: number = NODE_TIMEOUT_MS): number[] {
    return this.table.removeExpired(now, timeoutMs);
  }

  // ─── Aggregation (chain.rs handle_block) ───────────────────────────────────

  /**
   * Adopt a block reported by one node and derive the chain-level numbers.
   *
   * Propagation is a *chain* property, not a node one: the first node to
   * report a height gets 0, everyone after it gets the delay against that
   * first report.
   */
  private handleBlock(node: NodeState, block: BlockRef, now: number): void {
    this.updateStaleNodes(now);

    if (!node.updateBlock(block)) return;

    let propagationTime: number | undefined;
    if (this.best === undefined || block.height > this.best.height) {
      this.best = block;
      this.recordBlockTime(now);
      this.bestTimestamp = now;
      propagationTime = 0;
    } else if (block.height === this.best.height && this.bestTimestamp !== undefined) {
      propagationTime = Math.max(0, now - this.bestTimestamp);
    }

    node.updateBlockDetails(now, propagationTime);
  }

  private recordBlockTime(now: number): void {
    if (this.bestTimestamp === undefined) return;
    this.blockTimes.push(Math.max(0, now - this.bestTimestamp));
    if (this.blockTimes.length > BLOCK_TIME_WINDOW) this.blockTimes.shift();
    this.averageBlockTime = this.blockTimes.reduce((a, b) => a + b, 0) / this.blockTimes.length;
  }

  private handleFinalized(node: NodeState, block: BlockRef): void {
    if (!node.updateFinalized(block)) return;
    if (this.finalized === undefined || block.height > this.finalized.height) {
      this.finalized = block;
    }
  }

  /**
   * When no new best arrived within the stale timeout, mark quiet nodes stale
   * and recompute best/finalized from the live ones (chain.rs
   * update_stale_nodes). Without this, one dead node stuck at a high height
   * would freeze the chain's reported tip forever.
   */
  private updateStaleNodes(now: number): void {
    const threshold = now - STALE_TIMEOUT_MS;
    if (this.bestTimestamp === undefined || this.bestTimestamp > threshold) return;

    let best: BlockRef | undefined;
    let finalized: BlockRef | undefined;
    let timestamp: number | undefined;

    for (const node of this.table.values()) {
      if (node.updateStale(threshold)) continue;

      if (node.best && (best === undefined || node.best.block.height > best.height)) {
        best = node.best.block;
        timestamp = node.best.blockTimestamp;
      }
      if (node.finalized && (finalized === undefined || node.finalized.height > finalized.height)) {
        finalized = node.finalized;
      }
    }

    if (this.best !== undefined || this.finalized !== undefined) {
      this.best = best;
      this.finalized = finalized;
      this.bestTimestamp = timestamp;
    }
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  get nodeCount(): number {
    return this.table.size;
  }

  /** Chain label as the majority of nodes report it. */
  get label(): string {
    return this.table.label;
  }

  hasNode(key: string): boolean {
    return this.table.has(key);
  }

  getById(id: number): NodeState | undefined {
    return this.table.getById(id);
  }

  list(): NodeEntry[] {
    return this.table.entries();
  }

  /**
   * This minute's history row. Called by the reaper alarm, after the sweep, so
   * the counts describe the nodes that are actually still there.
   */
  snapshot(now: number): ChainSnapshot {
    return buildSnapshot(
      {
        genesisHash: this.genesisHash,
        nodes: this.table.entries(),
        best: this.best,
        finalized: this.finalized,
        averageBlockTime: this.averageBlockTime,
      },
      now,
    );
  }
}
