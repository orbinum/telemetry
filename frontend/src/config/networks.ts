/**
 * The networks this UI can show, and which telemetry worker serves each.
 *
 * A network only appears once its genesis hash is configured. Listing one
 * without it would offer the user a tab that can only ever fail: the worker
 * rejects chains outside its allowlist, so an unconfigured network has
 * nothing to show and no way to get anything.
 *
 * Testnet and mainnet are served by the deployed worker, whose allowlist
 * accepts only those two chains — that allowlist is what stops a public
 * ingest endpoint from spawning a Durable Object for any chain on the
 * internet.
 *
 * Devnet cannot live on the deployed worker: an ephemeral `--dev` chain gets
 * a fresh genesis on every restart, so it could never be allowlisted. A
 * developer runs their own worker instead (`pnpm dev:back`), where an empty
 * allowlist accepts every chain, and points their node at it:
 *
 *   orbinum-node --dev --telemetry-url "ws://localhost:8787/submit/ 1"
 *
 * Note this is the *worker's* port, not the node's RPC port (9944). A node
 * does not serve telemetry on its RPC port — that speaks JSON-RPC, and it
 * only knows its own view, so it has none of the cross-node numbers
 * (propagation, block time across the network) this UI exists to show.
 */

import { STORAGE_KEYS, readStored, writeStored } from "../utils/storage";

export type NetworkId = "testnet" | "mainnet" | "devnet";

export interface Network {
  id: NetworkId;
  label: string;
  /** Base URL of the telemetry worker serving this network. */
  apiBase: string;
  /**
   * Genesis hash this network's chain reports, when it is known ahead of
   * time. Devnet has none: its genesis changes on every node restart.
   */
  genesisHash?: string;
  /** Shown when the network has no nodes, to explain what to do about it. */
  emptyHint?: string;
}

/** Deployed worker, overridable at build time for staging. */
const PRODUCTION_API = import.meta.env.VITE_API_BASE ?? "https://telemetry.orbinum.io";

/** A developer's own `wrangler dev`. */
const LOCAL_API = import.meta.env.VITE_DEVNET_API_BASE ?? "http://localhost:8787";

const GENESIS_RE = /^0x[0-9a-f]{64}$/i;

/** Undefined unless the value is a real genesis hash, so a typo hides the tab. */
function configuredGenesis(raw: string | undefined): string | undefined {
  const hash = raw?.trim().toLowerCase();
  return hash !== undefined && GENESIS_RE.test(hash) ? hash : undefined;
}

/**
 * Every network the build knows about. `NETWORKS` is the filtered view the UI
 * should use; this stays exported for tests and for explaining an absence.
 */
export const ALL_NETWORKS: Network[] = [
  {
    id: "testnet",
    label: "Testnet",
    apiBase: PRODUCTION_API,
    genesisHash: configuredGenesis(import.meta.env.VITE_TESTNET_GENESIS),
  },
  {
    id: "mainnet",
    label: "Mainnet",
    apiBase: PRODUCTION_API,
    genesisHash: configuredGenesis(import.meta.env.VITE_MAINNET_GENESIS),
  },
  {
    id: "devnet",
    label: "Devnet",
    apiBase: LOCAL_API,
    // Deliberately no genesisHash: a --dev chain is ephemeral, so devnet is
    // available whenever a local worker is, and lists whatever it reports.
    emptyHint:
      "Devnet reads from a telemetry worker on your own machine. Start it with " +
      "`pnpm dev:back`, then run your node with " +
      '`--telemetry-url "ws://localhost:8787/submit/ 1"`.',
  },
];

/**
 * A network is offered when it can actually show something: a known genesis
 * for the fixed chains, and always for devnet, whose chain is discovered at
 * runtime from the local worker.
 */
export function isNetworkAvailable(network: Network): boolean {
  return network.id === "devnet" || network.genesisHash !== undefined;
}

/** The networks the UI offers. Empty is possible and handled by the UI. */
export const NETWORKS: Network[] = ALL_NETWORKS.filter(isNetworkAvailable);

/** The first available network; devnet is always there as a fallback. */
export const DEFAULT_NETWORK: NetworkId = NETWORKS[0]?.id ?? "devnet";

export function getNetwork(id: NetworkId): Network | undefined {
  return NETWORKS.find((n) => n.id === id);
}

/** ws:// or wss:// counterpart of a network's API base. */
export function wsBase(network: Network): string {
  return network.apiBase.replace(/^http/, "ws");
}

/**
 * The last network the user picked, if it is still available — a network can
 * disappear between visits when its genesis is removed from the build.
 */
export function loadNetwork(): NetworkId {
  const stored = readStored(STORAGE_KEYS.network, (raw) =>
    NETWORKS.some((n) => n.id === raw) ? (raw as NetworkId) : undefined,
  );
  return stored ?? DEFAULT_NETWORK;
}

export function saveNetwork(id: NetworkId): void {
  writeStored(STORAGE_KEYS.network, id);
}
