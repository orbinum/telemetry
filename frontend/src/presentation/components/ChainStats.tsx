/** Chain header: name, connection status, and the four headline numbers. */

import { StatCard, StatCardRow } from "./ui/StatCard";
import { cn } from "./ui/cn";
import { useChain, useFeedStatus } from "../../stores/feedStore";
import { formatHeight, formatMs, formatNumber } from "../../utils/format";

export function ChainStats() {
  const chain = useChain();
  const status = useFeedStatus();

  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="wordmark text-2xl">{chain?.label || "Orbinum Telemetry"}</h1>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.12em]",
            status === "live"
              ? "bg-success-tint text-success"
              : status === "outdated"
                ? "bg-error-tint text-error"
                : "bg-warning-tint text-warning",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      </div>

      {/* A banner, not a pill: the table below is frozen and stays that way.
          Reloading is manual — automatic would loop mid-rollout. */}
      {status === "outdated" && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-error-mix bg-error-tint px-4 py-3 text-sm text-error"
        >
          <span>
            This page is running an older version than the server. The data below has stopped
            updating.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-error-mix px-3 py-1 font-medium hover:bg-error-mix"
          >
            Reload
          </button>
        </div>
      )}

      <StatCardRow>
        <StatCard label="Nodes" value={formatNumber(chain?.nodeCount)} />
        <StatCard label="Best block" value={formatHeight(chain?.best)} />
        <StatCard label="Finalized" value={formatHeight(chain?.finalized)} />
        <StatCard label="Avg block time" value={formatMs(chain?.averageBlockTime)} />
      </StatCardRow>
    </div>
  );
}
