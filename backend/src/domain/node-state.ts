/**
 * NodeState — live state for one reporting node.
 *
 * Faithful port of telemetry_core/src/state/node.rs, minus the reference's
 * block-import throttle (our 100ms feed batching subsumes it, plan §6).
 * Pure domain: no I/O, no clock — time always enters as a parameter.
 */

import { MeanList } from "./mean-list";
import type {
  BlockRef,
  HwBenchMessage,
  NodeDetails,
  SystemConnectedMessage,
  SystemIntervalMessage,
} from "../protocol/node";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Approximate node location, captured from `request.cf` at upgrade time. */
export interface NodeGeo {
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

/** Best block plus the timing info the UI's block/propagation columns need. */
export interface BlockDetails {
  block: BlockRef;
  /** Wall-clock ms when this node reported the block. */
  blockTimestamp: number;
  /** Delta against the node's previous best, ms. */
  blockTime?: number;
  /** Delay against the first node that reported this height, ms. 0 = first. */
  propagationTime?: number;
}

export interface NodeHwBench {
  cpuHashrateScore: number;
  memoryMemcpyScore: number;
  diskSequentialWriteScore?: number;
  diskRandomWriteScore?: number;
  parallelCpuHashrateScore?: number;
}

// ─── State ───────────────────────────────────────────────────────────────────

export class NodeState {
  readonly details: NodeDetails;
  readonly genesisHash: string;
  readonly geo?: NodeGeo;
  /** Wall-clock ms of the system.connected that created this state. */
  readonly connectedAt: number;
  /** Wall-clock ms of the last message — feeds the 60s reaper. */
  lastSeen: number;

  peers?: number;
  txcount?: number;
  best?: BlockDetails;
  finalized?: BlockRef;
  stale = false;
  hwbench?: NodeHwBench;
  validator?: string;

  /** Bounded chart series (plan §7): cheap to keep, rendered in v2. */
  readonly upload = new MeanList();
  readonly download = new MeanList();
  readonly chartStamps = new MeanList();
  readonly usedStateCacheSize = new MeanList();

  constructor(msg: SystemConnectedMessage, geo: NodeGeo | undefined, now: number) {
    this.details = msg.node;
    this.genesisHash = msg.genesisHash;
    this.geo = geo;
    this.connectedAt = now;
    this.lastSeen = now;
    this.validator = msg.node.validator;
  }

  /**
   * Adopt a new best block. Returns true when the block moved the node
   * forward — a lagging duplicate frame must not rewind it (node.rs
   * update_block). Timing details are set separately by updateBlockDetails,
   * after the chain has computed propagation.
   */
  updateBlock(block: BlockRef): boolean {
    if (this.best === undefined || block.height > this.best.block.height) {
      this.stale = false;
      const previousTimestamp = this.best?.blockTimestamp;
      this.best = { block, blockTimestamp: previousTimestamp ?? 0 };
      return true;
    }
    return false;
  }

  /** Stamp timing on the current best (node.rs update_details, no throttle). */
  updateBlockDetails(now: number, propagationTime: number | undefined): void {
    if (this.best === undefined) return;
    this.best.blockTime =
      this.best.blockTimestamp === 0 ? undefined : now - this.best.blockTimestamp;
    this.best.blockTimestamp = now;
    this.best.propagationTime = propagationTime;
  }

  /** Only move finalized forward (node.rs update_finalized). */
  updateFinalized(block: BlockRef): boolean {
    if (this.finalized === undefined || block.height > this.finalized.height) {
      this.finalized = block;
      return true;
    }
    return false;
  }

  /** Merge the non-block half of a system.interval (stats + hardware + io). */
  updateInterval(msg: SystemIntervalMessage, now: number): void {
    if (msg.peers !== undefined) this.peers = msg.peers;
    if (msg.txcount !== undefined) this.txcount = msg.txcount;
    if (msg.bandwidthUpload !== undefined) this.upload.push(msg.bandwidthUpload);
    if (msg.bandwidthDownload !== undefined) this.download.push(msg.bandwidthDownload);
    if (msg.usedStateCacheSize !== undefined) this.usedStateCacheSize.push(msg.usedStateCacheSize);
    this.chartStamps.push(now);
  }

  /** Mark stale when the best block is older than `threshold` (node.rs update_stale). */
  updateStale(threshold: number): boolean {
    if ((this.best?.blockTimestamp ?? 0) < threshold) {
      this.stale = true;
    }
    return this.stale;
  }

  updateHwBench(msg: HwBenchMessage): void {
    this.hwbench = {
      cpuHashrateScore: msg.cpuHashrateScore,
      memoryMemcpyScore: msg.memoryMemcpyScore,
      diskSequentialWriteScore: msg.diskSequentialWriteScore,
      diskRandomWriteScore: msg.diskRandomWriteScore,
      parallelCpuHashrateScore: msg.parallelCpuHashrateScore,
    };
  }

  /** afg.authority_set carries the validator address (requires verbosity ≥ 1). */
  setValidatorAddress(address: string): void {
    this.validator = address;
  }

  /** True when the node has gone quiet for longer than `timeoutMs`. */
  isExpired(now: number, timeoutMs: number): boolean {
    return now - this.lastSeen > timeoutMs;
  }
}
