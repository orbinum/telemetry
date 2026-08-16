/**
 * Which network the UI is showing, and the chains that network's worker
 * reports. The choice persists, so someone watching one network does not
 * re-pick it on every reload.
 *
 * Switching networks resets the feed before anything else: leaving the
 * previous network's nodes on screen under the new network's name reads as
 * live data and is wrong, which is worse than showing nothing.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getNetwork, loadNetwork, saveNetwork } from "../config/networks";
import { resetFeed } from "./feedStore";
import { fetchChains } from "../services/chains";
import type { Network, NetworkId } from "../config/networks";
import type { ChainDirectoryEntry } from "../../../shared/protocol/feed";

interface NetworkState {
  networkId: NetworkId;
  chains: ChainDirectoryEntry[];
  loading: boolean;
  /** Set when the network's worker could not be reached. */
  error?: string;
}

const useNetworkStore = create<NetworkState>(() => ({
  networkId: loadNetwork(),
  chains: [],
  loading: true,
  error: undefined,
}));

/** Guards against a slow response from a network the user already left. */
let inFlight = 0;

/** Load the chain directory of the current network. */
export async function refreshChains(): Promise<void> {
  const requestId = ++inFlight;
  const { networkId } = useNetworkStore.getState();
  const network = getNetwork(networkId);

  // No network is available at all (nothing configured, no local worker).
  if (network === undefined) {
    useNetworkStore.setState({ chains: [], loading: false, error: undefined });
    return;
  }

  useNetworkStore.setState({ loading: true, error: undefined });

  try {
    const chains = await fetchChains(network.apiBase);
    if (requestId !== inFlight) return;
    useNetworkStore.setState({ chains, loading: false });
  } catch (err: unknown) {
    if (requestId !== inFlight) return;
    useNetworkStore.setState({
      chains: [],
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function setNetwork(networkId: NetworkId): void {
  if (useNetworkStore.getState().networkId === networkId) return;
  saveNetwork(networkId);

  // Tear the feed down before anything else. Without this the previous
  // network's nodes stay on screen — labelled as the new network and still
  // reporting "live" — for as long as the new one takes to answer, which is
  // forever when it is unreachable.
  resetFeed();

  useNetworkStore.setState({ networkId, chains: [], loading: true, error: undefined });
  void refreshChains();
}

// ─── Selectors ───────────────────────────────────────────────────────────────

export function useNetworkId(): NetworkId {
  return useNetworkStore((s) => s.networkId);
}

/** The active network, or undefined when the build configured none. */
export function useNetwork(): Network | undefined {
  return getNetwork(useNetworkStore((s) => s.networkId));
}

export function useChains(): ChainDirectoryEntry[] {
  return useNetworkStore(useShallow((s) => s.chains));
}

export function useChainsLoading(): boolean {
  return useNetworkStore((s) => s.loading);
}

export function useChainsError(): string | undefined {
  return useNetworkStore((s) => s.error);
}
