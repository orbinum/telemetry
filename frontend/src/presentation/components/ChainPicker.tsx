/**
 * Picks between the chains one network reports.
 *
 * Hidden with a single chain, which is the normal case — the allowlist keeps
 * each network to one. It earns its place on a worker whose TELEMETRY_CHAINS
 * lists several, such as a fork under test.
 */

import { TabLink } from "./ui/Tab";
import type { ChainDirectoryEntry } from "../../../../shared/protocol/feed";

export function ChainPicker({ chains }: { chains: ChainDirectoryEntry[] }) {
  if (chains.length < 2) return null;

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {chains.map((chain) => (
        <TabLink key={chain.genesisHash} to={`/chain/${chain.genesisHash}`}>
          {chain.label}
        </TabLink>
      ))}
    </div>
  );
}
