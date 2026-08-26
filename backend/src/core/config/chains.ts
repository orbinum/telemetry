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
 * There is no way to switch the allowlist off. A `--dev` chain gets a fresh
 * genesis on every restart, so it could never be listed here anyway, and an
 * accept-everything mode is the memory-exhaustion vector this file exists to
 * close — one that a stray var in the wrong environment would reopen. A
 * developer who wants their own chain runs their own worker and puts that
 * chain's genesis in `TELEMETRY_CHAINS`, restarting when it changes.
 */

const GENESIS_RE = /^0x[0-9a-f]{64}$/;

/** The vars that feed the allowlist. All optional; all validated. */
export interface ChainConfig {
  TELEMETRY_TESTNET_GENESIS?: string;
  TELEMETRY_MAINNET_GENESIS?: string;
  /**
   * Comma-separated extras, for chains without a dedicated var: a fork under
   * test, or a developer's own chain on their own worker.
   */
  TELEMETRY_CHAINS?: string;
}

/**
 * Build the allowlist from the environment. Invalid entries are dropped
 * rather than throwing: one typo must not take the whole ingest down — but it
 * does then leave a smaller allowlist, never an open one, because an empty
 * result rejects everything (see isChainAllowed).
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
 * Whether this worker accepts nodes from a chain.
 *
 * Fail-closed: an empty allowlist rejects everything. A misconfigured
 * deployment then serves nobody, which is loud and harmless — the opposite
 * default would silently accept every chain on the internet.
 */
export function isChainAllowed(allowed: Set<string>, genesisHash: string): boolean {
  return allowed.has(genesisHash.toLowerCase());
}
