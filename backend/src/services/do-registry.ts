/**
 * Durable Object registry — the only place that knows which DO owns what.
 *
 * Node sockets land on a GatewayDO partitioned by client IP, because the
 * chain is unknown until system.connected arrives (plan §3.2). Chain state
 * and browser feeds live in a ChainDO keyed by genesis hash. Keeping both
 * lookups here means a change in topology touches one file.
 */

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

/** The gateway partition that owns this client's sockets. */
export function gatewayStub(env: CloudflareBindings, clientIp: string): DurableObjectStub {
  return gatewayPartitionStub(env, fnv1a(clientIp) % GATEWAY_PARTITIONS);
}

/** A gateway partition by index — used by the /chains directory fan-in. */
export function gatewayPartitionStub(
  env: CloudflareBindings,
  partition: number,
): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName(`gateway-${partition}`));
}

/** The ChainDO owning one chain — used by the feed route. */
export function chainStub(env: CloudflareBindings, genesisHash: string): DurableObjectStub {
  return env.CHAIN.get(env.CHAIN.idFromName(genesisHash));
}
