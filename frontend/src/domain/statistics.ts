/**
 * Live chain statistics, aggregated over the nodes currently visible.
 *
 * Pure by design: the stats page derives everything from the snapshot it
 * already has. The reference's stats tab is a set of live histograms rather
 * than a time series (plan §3.3), so nothing here is stored or accumulated.
 */

import type { FeedNode } from "../../../shared/protocol/feed";

export interface ChainStatistics {
  version: Map<string, number>;
  implementation: Map<string, number>;
  location: Map<string, number>;
  validatorStatus: Map<string, number>;
  /** Median milliseconds between blocks, across nodes that reported one. */
  medianBlockTime?: number;
  /** Median propagation delay, the number that says "is the network healthy". */
  medianPropagation?: number;
  staleCount: number;
}

function tally(target: Map<string, number>, key: string | undefined): void {
  const label = key === undefined || key === "" ? "unknown" : key;
  target.set(label, (target.get(label) ?? 0) + 1);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeStatistics(nodes: FeedNode[]): ChainStatistics {
  const version = new Map<string, number>();
  const implementation = new Map<string, number>();
  const location = new Map<string, number>();
  const validatorStatus = new Map<string, number>();
  const blockTimes: number[] = [];
  const propagations: number[] = [];
  let staleCount = 0;

  for (const node of nodes) {
    tally(version, node.version);
    tally(implementation, node.implementation);
    tally(
      location,
      node.geo?.country === undefined && node.geo?.city === undefined
        ? undefined
        : (node.geo.country ?? node.geo.city),
    );
    tally(validatorStatus, node.authority === true ? "validator" : "full node");
    if (node.blockTime !== undefined) blockTimes.push(node.blockTime);
    if (node.propagationTime !== undefined) propagations.push(node.propagationTime);
    if (node.stale) staleCount++;
  }

  return {
    version,
    implementation,
    location,
    validatorStatus,
    medianBlockTime: median(blockTimes),
    medianPropagation: median(propagations),
    staleCount,
  };
}
