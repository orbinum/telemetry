/**
 * Genesis-hash allowlist (plan §6).
 *
 * A public /submit endpoint would otherwise accept nodes from *any* chain —
 * someone pointing a Polkadot node at us would spawn a ChainDO and consume
 * memory forever. One check replaces the reference's per-chain node cap and
 * its chain denylist.
 *
 * The hashes are environment config, never constants in code: testnet's
 * genesis already changed once (TOPOLOGY.md still documents a stale one), and
 * mainnet's does not exist yet. Set `TELEMETRY_TESTNET_GENESIS` and
 * `TELEMETRY_MAINNET_GENESIS` per environment; `TELEMETRY_CHAINS` stays
 * available for a fork under test.
 *
 * Devnet deliberately does **not** belong here. A `--dev` chain gets a fresh
 * genesis on every restart, so it could never be allowlisted, and opening the
 * deployed worker to arbitrary chains is exactly the memory-exhaustion vector
 * this file exists to close. Developers run their own worker instead, where
 * an empty allowlist accepts everything; the UI's Devnet option points at it.
 */

const GENESIS_RE = /^0x[0-9a-f]{64}$/;

/** The vars that feed the allowlist. All optional; all validated. */
export interface ChainConfig {
  TELEMETRY_TESTNET_GENESIS?: string;
  TELEMETRY_MAINNET_GENESIS?: string;
  /** Comma-separated extras, for chains without a dedicated var. */
  TELEMETRY_CHAINS?: string;
}

/**
 * Build the allowlist from the environment. Invalid entries are dropped
 * rather than throwing: one typo must not take the whole ingest down.
 *
 * An empty result means "accept every chain". That is what `wrangler dev`
 * wants, because a `--dev` chain gets a fresh genesis on every restart;
 * production always sets at least one hash, and the GatewayDO warns loudly
 * when the allowlist ends up empty.
 */
export function parseAllowedChains(env: ChainConfig): Set<string> {
  const candidates = [
    env.TELEMETRY_TESTNET_GENESIS,
    env.TELEMETRY_MAINNET_GENESIS,
    ...(env.TELEMETRY_CHAINS?.split(",") ?? []),
  ];

  return new Set(
    candidates
      .map((hash) => hash?.trim().toLowerCase())
      .filter((hash): hash is string => hash !== undefined && GENESIS_RE.test(hash)),
  );
}

/**
 * Whether this worker accepts nodes from a chain. An empty allowlist accepts
 * everything; see parseAllowedChains for why.
 */
export function isChainAllowed(allowed: Set<string>, genesisHash: string): boolean {
  if (allowed.size === 0) return true;
  return allowed.has(genesisHash.toLowerCase());
}
