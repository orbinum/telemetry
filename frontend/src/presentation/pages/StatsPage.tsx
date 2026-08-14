/**
 * Stats — live histograms over the nodes currently reporting. Not a time
 * series: history is deliberately out of scope for v1 (plan §3.3).
 */

import { Histogram } from "../components/Histogram";
import { EmptyState } from "../components/ui/EmptyState";
import { StatCard, StatCardRow } from "../components/ui/StatCard";
import { computeStatistics } from "../../domain/statistics";
import { useVisibleNodes } from "../../stores/feedStore";
import { formatMs, formatNumber } from "../../utils/format";

export function StatsPage() {
  const nodes = useVisibleNodes();

  if (nodes.length === 0) {
    return <EmptyState>No nodes reporting yet.</EmptyState>;
  }

  const stats = computeStatistics(nodes);

  return (
    <div className="flex flex-col gap-4">
      <StatCardRow>
        <StatCard label="Nodes" value={formatNumber(nodes.length)} />
        <StatCard label="Median block time" value={formatMs(stats.medianBlockTime)} />
        <StatCard label="Median propagation" value={formatMs(stats.medianPropagation)} />
        <StatCard label="Stale" value={formatNumber(stats.staleCount)} />
      </StatCardRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <Histogram title="Version" buckets={stats.version} />
        <Histogram title="Implementation" buckets={stats.implementation} />
        <Histogram title="Location" buckets={stats.location} />
        <Histogram title="Role" buckets={stats.validatorStatus} />
      </div>
    </div>
  );
}
