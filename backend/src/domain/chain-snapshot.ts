/**
 * One minute of chain history, aggregated from the live node table.
 *
 * This is what gets persisted, and it is deliberately not a dump of node
 * state: node state rebuilds itself from the wire in seconds, so the only
 * thing worth writing down is what no restart can recover — the shape of the
 * network at a point in time.
 *
 * Aggregating here rather than storing a row per node is what keeps the write
 * cost independent of how many nodes report: 5 and 500 both produce one row.
 *
 * Pure: takes a node list and a clock reading, returns a value. No I/O.
 */

import type { NodeEntry } from "./node-table";

/** Bucket width. Matches the ChainDO reaper alarm, which does the writing. */
export const BUCKET_MS = 60_000;

/**
 * Distinct values kept per histogram.
 *
 * `version` and `implementation` are free-form strings a node chooses for
 * itself, bounded only in length. Without a cap here, a fleet reporting 500
 * distinct versions would write a 20 KB row every minute — the histogram
 * exists to collapse cardinality, so it must not become a way to smuggle it
 * back in. The tail is dropped rather than bucketed into "other": a count that
 * silently merges unrelated versions reads as fact and isn't one.
 */
export const MAX_HISTOGRAM_ENTRIES = 20;

/** Counts by label, e.g. `{"0.2.5": 11, "0.2.4": 3}`. */
export type Histogram = Record<string, number>;

export interface ChainSnapshot {
  genesisHash: string;
  /** Wall-clock ms floored to the bucket — the row's identity, with genesis. */
  bucket: number;

  nodeCount: number;
  authorityCount: number;
  staleCount: number;

  bestHeight?: number;
  finalizedHeight?: number;
  /** best − finalized. Stored because a finality stall is the query. */
  finalityLag?: number;
  averageBlockTimeMs?: number;

  versions: Histogram;
  implementations: Histogram;
  countries: Histogram;
}

/** Floor a timestamp to its bucket, so a repeated alarm overwrites its row. */
export function bucketOf(now: number, width: number = BUCKET_MS): number {
  return Math.floor(now / width) * width;
}

function tally(counts: Map<string, number>, label: string | undefined): void {
  if (label === undefined || label === "") return;
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

/** The `MAX_HISTOGRAM_ENTRIES` most common labels, as a plain object. */
function topEntries(counts: Map<string, number>): Histogram {
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_HISTOGRAM_ENTRIES),
  );
}

export interface SnapshotInput {
  genesisHash: string;
  nodes: NodeEntry[];
  best?: { height: number };
  finalized?: { height: number };
  averageBlockTime?: number;
}

/** Aggregate the live node table into the row that will be written. */
export function buildSnapshot(input: SnapshotInput, now: number): ChainSnapshot {
  const versions = new Map<string, number>();
  const implementations = new Map<string, number>();
  const countries = new Map<string, number>();
  let authorityCount = 0;
  let staleCount = 0;

  for (const { node } of input.nodes) {
    tally(versions, node.details.version);
    tally(implementations, node.details.implementation);
    tally(countries, node.geo?.country);
    if (node.details.authority === true) authorityCount++;
    if (node.stale) staleCount++;
  }

  const bestHeight = input.best?.height;
  const finalizedHeight = input.finalized?.height;

  return {
    genesisHash: input.genesisHash,
    bucket: bucketOf(now),
    nodeCount: input.nodes.length,
    authorityCount,
    staleCount,
    bestHeight,
    finalizedHeight,
    // Only meaningful with both ends; never negative, since a node may report a
    // finalized height above the current best during a stale sweep.
    finalityLag:
      bestHeight === undefined || finalizedHeight === undefined
        ? undefined
        : Math.max(0, bestHeight - finalizedHeight),
    averageBlockTimeMs: input.averageBlockTime,
    versions: topEntries(versions),
    implementations: topEntries(implementations),
    countries: topEntries(countries),
  };
}
