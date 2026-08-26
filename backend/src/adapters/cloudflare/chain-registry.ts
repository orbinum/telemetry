/**
 * `ChainRegistry` over Durable Object namespaces — the only place that knows
 * which object owns what.
 *
 * Node sockets land on a GatewayDO partitioned by client IP, because the
 * chain is unknown until system.connected arrives (plan §3.2). Chain state
 * and browser feeds live in a ChainDO keyed by genesis hash. Keeping both
 * lookups here means a change in topology touches one file.
 */

import type { ChainRegistry, Fetcher } from "../../ports/chains";

/** Gateway partitions. Raising this re-shards sockets, not state. */
export const GATEWAY_PARTITIONS = 4;

/** Stable tiny hash (FNV-1a) — only needs to spread IPs across partitions. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Resolves each owner to the Durable Object holding it. */
export function durableObjectRegistry(env: CloudflareBindings): ChainRegistry {
  const gatewayPartition = (partition: number): Fetcher =>
    env.GATEWAY.get(env.GATEWAY.idFromName(`gateway-${partition}`));

  return {
    gatewayFor: (clientIp: string) => gatewayPartition(fnv1a(clientIp) % GATEWAY_PARTITIONS),
    gatewayPartition,
    chain: (genesisHash: string) => env.CHAIN.get(env.CHAIN.idFromName(genesisHash)),
  };
}
