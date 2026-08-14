/**
 * Resolves which chain to show and keeps its feed connected.
 *
 * The chain lives in the URL so a view is shareable, but a URL outlives the
 * network it was copied from: switching networks, or opening an old link,
 * can name a chain the current worker does not serve. Rather than showing an
 * empty view for a chain that is not there, the route only wins while the
 * network actually lists it.
 */

import { useEffect } from "react";
import { useParams } from "react-router";
import { wsBase } from "../../config/networks";
import { connectFeed, disconnectFeed } from "../../stores/feedStore";
import { refreshChains, useChains, useNetwork } from "../../stores/networkStore";

export function useChainFeed(): { selected: string | undefined } {
  const { genesisHash } = useParams();
  const network = useNetwork();
  const chains = useChains();

  useEffect(() => {
    void refreshChains();
  }, []);

  const routed = genesisHash !== undefined && chains.some((c) => c.genesisHash === genesisHash);
  const selected = routed ? genesisHash : chains[0]?.genesisHash;

  useEffect(() => {
    if (selected === undefined || network === undefined) return;
    connectFeed(selected, wsBase(network));
    return () => disconnectFeed();
  }, [selected, network]);

  return { selected };
}
