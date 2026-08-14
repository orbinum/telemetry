/**
 * Network picker.
 *
 * Only shows networks the build can actually serve — see `config/networks` —
 * and hides itself entirely when that leaves fewer than two, since a single
 * button is not a choice.
 */

import { NETWORKS } from "../../config/networks";
import { setNetwork, useNetworkId } from "../../stores/networkStore";
import { TabButton } from "./ui/Tab";

export function NetworkSwitcher() {
  const active = useNetworkId();

  if (NETWORKS.length < 2) return null;

  return (
    <div className="flex" role="group" aria-label="Network">
      {NETWORKS.map((network) => (
        <TabButton
          key={network.id}
          active={network.id === active}
          onClick={() => setNetwork(network.id)}
          title={network.apiBase}
          // Collapse the shared borders into one line.
          className="-ml-px first:ml-0"
        >
          {network.label}
        </TabButton>
      ))}
    </div>
  );
}
