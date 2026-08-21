/**
 * Domain → wire serialization for the browser feed. The only place that knows
 * both `NodeState`/`ChainState` and the feed shapes — domain stays wire-free
 * and the wire stays domain-free (plan §3.1).
 */

import type { FeedChain, FeedNode, FeedNodeSeries } from "../../../shared/protocol/feed";
import { nodeTypeOf } from "../domain/node-type";
import type { ChainState } from "../domain/chain-state";
import type { NodeState } from "../domain/node-state";

/**
 * One node as the feed carries it.
 *
 * `full` adds the fields that are fixed for a session — target triple, sysinfo
 * and hwbench. They ride the snapshot and the delta that introduces a node,
 * and are left out of every later delta: at 500 nodes they are ~40% of the
 * batch and cannot have changed.
 *
 * hwbench is in that set even though it lands *after* connect: the DO reopens
 * the node when it arrives, so the next delta carries it as a full row.
 */
export function toFeedNode(id: number, node: NodeState, full = false): FeedNode {
  const startup = node.details.startupTime === undefined ? NaN : Number(node.details.startupTime);
  return {
    id,
    name: node.details.name,
    implementation: node.details.implementation,
    version: node.details.version,
    authority: node.details.authority,
    nodeType: nodeTypeOf(node.details),
    validator: node.validator,
    networkId: node.details.networkId,
    startupTime: Number.isFinite(startup) ? startup : undefined,
    peers: node.peers,
    txcount: node.txcount,
    best: node.best?.block,
    blockTime: node.best?.blockTime,
    propagationTime: node.best?.propagationTime,
    lastBlockAt: node.best === undefined ? undefined : node.best.blockTimestamp,
    finalized: node.finalized,
    stale: node.stale,
    geo: node.geo,
    ...(full
      ? {
          targetOs: node.details.targetOs,
          targetArch: node.details.targetArch,
          targetEnv: node.details.targetEnv,
          sysinfo: node.details.sysinfo,
          hwbench: node.hwbench,
        }
      : {}),
  };
}

/** The four chart series a node keeps, materialized from their MeanLists. */
export function toFeedNodeSeries(id: number, node: NodeState): FeedNodeSeries {
  return {
    id,
    upload: node.upload.slice(),
    download: node.download.slice(),
    usedStateCacheSize: node.usedStateCacheSize.slice(),
    chartStamps: node.chartStamps.slice(),
  };
}

export function toFeedChain(chain: ChainState): FeedChain {
  return {
    genesisHash: chain.genesisHash,
    label: chain.label,
    nodeCount: chain.nodeCount,
    best: chain.best,
    finalized: chain.finalized,
    averageBlockTime: chain.averageBlockTime,
  };
}
