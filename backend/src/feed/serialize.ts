/**
 * Domain → wire serialization for the browser feed. The only place that knows
 * both `NodeState`/`ChainState` and the feed shapes — domain stays wire-free
 * and the wire stays domain-free (plan §3.1).
 */

import type { FeedChain, FeedNode } from "../../../shared/protocol/feed";
import type { ChainState } from "../domain/chain-state";
import type { NodeState } from "../domain/node-state";

export function toFeedNode(id: number, node: NodeState): FeedNode {
  const startup = node.details.startupTime === undefined ? NaN : Number(node.details.startupTime);
  return {
    id,
    name: node.details.name,
    implementation: node.details.implementation,
    version: node.details.version,
    authority: node.details.authority,
    validator: node.validator,
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
