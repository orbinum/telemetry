/**
 * Chain shell — the header and navigation shared by every chain view.
 *
 * Owns the feed connection (through `useChainFeed`) so moving between the
 * node list and the stats tab does not tear the socket down and reconnect.
 */

import { Outlet } from "react-router";
import { ChainPicker } from "../components/ChainPicker";
import { ChainStats } from "../components/ChainStats";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/EmptyState";
import { TabLink } from "../components/ui/Tab";
import { useChainFeed } from "../hooks/useChainFeed";
import { useChains, useChainsError, useChainsLoading, useNetwork } from "../../stores/networkStore";

export function ChainLayout() {
  const network = useNetwork();
  const chains = useChains();
  const loading = useChainsLoading();
  const error = useChainsError();
  const { selected } = useChainFeed();

  // The build configured no network and there is no local worker to fall
  // back on, so there is nothing to connect to at all.
  if (network === undefined) {
    return (
      <Shell>
        <EmptyState
          hint={
            <>
              Set <code>VITE_TESTNET_GENESIS</code> or <code>VITE_MAINNET_GENESIS</code> to the
              genesis hash of the chain to display.
            </>
          }
        >
          No telemetry network is configured for this build.
        </EmptyState>
      </Shell>
    );
  }

  const noChains = error === undefined && !loading && chains.length === 0;

  return (
    <Shell>
      {error !== undefined && (
        <ErrorState hint={network.emptyHint}>
          Could not reach the {network.label.toLowerCase()} telemetry service at{" "}
          <code>{network.apiBase}</code>.
        </ErrorState>
      )}

      <ChainPicker chains={chains} />
      <ChainStats />

      {selected !== undefined && (
        <div className="mb-5 flex gap-2">
          <TabLink to={`/chain/${selected}`} end>
            Nodes
          </TabLink>
          <TabLink to={`/chain/${selected}/stats`}>Stats</TabLink>
          <TabLink to={`/chain/${selected}/map`}>Map</TabLink>
        </div>
      )}

      {/* Order matters: the directory request has to settle before its result
          means anything. Rendering the Outlet while it is in flight shows the
          node list's own "no nodes reporting yet" — a claim about the network
          made before anyone asked it. */}
      {loading && chains.length === 0 ? (
        <LoadingState>
          Looking for chains on the {network.label.toLowerCase()} service…
        </LoadingState>
      ) : noChains ? (
        <EmptyState hint={network.emptyHint}>
          No chains are reporting to the {network.label.toLowerCase()} telemetry service yet.
        </EmptyState>
      ) : (
        <Outlet />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1600px] px-6 py-8">{children}</main>;
}
