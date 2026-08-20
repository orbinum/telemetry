/**
 * Map — where the reporting nodes are, and how concentrated they are.
 *
 * Same shape as StatsPage: read the visible nodes once, derive in `domain/`,
 * render. Nothing here is stored or accumulated.
 */

import { NodeMap } from "../components/NodeMap";
import { EmptyState } from "../components/ui/EmptyState";
import { StatCard, StatCardRow } from "../components/ui/StatCard";
import { computeMapPoints, countUnplaceable } from "../../domain/map-points";
import { useVisibleNodes } from "../../stores/feedStore";
import { formatNumber } from "../../utils/format";

export function MapPage() {
  const nodes = useVisibleNodes();

  if (nodes.length === 0) {
    return <EmptyState>No nodes reporting yet.</EmptyState>;
  }

  const points = computeMapPoints(nodes);
  const unplaceable = countUnplaceable(nodes);
  const countries = new Set(
    nodes.map((node) => node.geo?.country).filter((country) => country !== undefined),
  );
  const validators = nodes.filter((node) => node.nodeType === "validator").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Four cards, because StatCardRow is a 2×2 / 1×4 grid — three would
          leave a hole on every breakpoint. */}
      <StatCardRow>
        <StatCard label="Nodes" value={formatNumber(nodes.length)} />
        <StatCard label="Validators" value={formatNumber(validators)} />
        <StatCard label="Locations" value={formatNumber(points.length)} />
        <StatCard label="Countries" value={formatNumber(countries.size)} />
      </StatCardRow>

      <NodeMap points={points} unplaceable={unplaceable} />
    </div>
  );
}
