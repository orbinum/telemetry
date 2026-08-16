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
 * There is deliberately no devnet entry. The deployed worker rejects a `--dev`
 * chain outright, and its genesis changes on every restart, so no fixed entry
 * could ever match one. A developer who wants to watch their own node runs
 * their own worker with that chain's genesis in `TELEMETRY_CHAINS`, and points
 * this UI at it with `VITE_API_BASE=http://localhost:8787`.
 */

import { STORAGE_KEYS, readStored, writeStored } from "../utils/storage";

export type NetworkId = "testnet" | "mainnet";

export interface Network {
  id: NetworkId;
  label: string;
  /** Base URL of the telemetry worker serving this network. */
  apiBase: string;
  /** Genesis hash this network's chain reports; absent hides the network. */
  genesisHash?: string;
  /** Shown when the network has no nodes, to explain what to do about it. */
  emptyHint?: string;
}

/** Deployed worker, overridable at build time for staging or a local worker. */
const PRODUCTION_API = import.meta.env.VITE_API_BASE ?? "https://telemetry.orbinum.io";

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
];

/**
 * A network is offered when it can actually show something: the worker's
 * allowlist rejects chains it does not know, so an unconfigured genesis means
 * a tab with nothing behind it.
 */
export function isNetworkAvailable(network: Network): boolean {
  return network.genesisHash !== undefined;
}

/** The networks the UI offers. Empty is possible and handled by the UI. */
export const NETWORKS: Network[] = ALL_NETWORKS.filter(isNetworkAvailable);

/**
 * The first available network. Falls back to testnet for a build that
 * configured no genesis at all — the UI shows that tab empty, which is the
 * honest outcome of a build with nothing to point at.
 */
export const DEFAULT_NETWORK: NetworkId = NETWORKS[0]?.id ?? "testnet";

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
