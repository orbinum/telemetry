/**
 * One node row. Memo'd and subscribed to its own id, so a delta for one node
 * re-renders one row instead of the table (plan §8, point 3).
 *
 * A grid row, not a <tr>: one shared column template keeps every row aligned
 * with the header. Column widths come from `.node-grid`.
 */

import { memo } from "react";
import { CopyButton } from "./ui/CopyButton";
import { useNode } from "../../stores/feedStore";
import type { NodeType } from "../../../../shared/protocol/feed";
import {
  NO_VALUE,
  formatAgo,
  formatHeight,
  formatLocation,
  formatMs,
  formatNumber,
  shortHash,
} from "../../utils/format";

const TYPE_TITLES: Record<NodeType, string> = {
  validator: "Runs with --validator (reported by the node itself)",
  rpc: "Not an authority",
};

interface NodeRowProps {
  id: number;
  now: number;
}

export const NodeRow = memo(function NodeRow({ id, now }: NodeRowProps) {
  const node = useNode(id);
  if (node === undefined) return null;

  return (
    <div className="node-grid-row">
      <div className="font-sans font-medium text-accent">
        <span className="flex items-center gap-2">
          {node.stale && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
              title="No new block in over 2 minutes"
            />
          )}
          {/* The PeerId rides in the title rather than a column: it is 52
              characters no one reads at a glance, but it is the only stable
              identifier a node has, so it belongs where it can be checked. */}
          <span className="truncate" title={node.networkId}>
            {node.name}
          </span>
        </span>
      </div>
      <div className="text-muted">
        {node.implementation} <span className="opacity-60">{node.version}</span>
      </div>
      <div className="text-muted">
        <span title={TYPE_TITLES[node.nodeType]}>{node.nodeType}</span>
      </div>
      <div className="text-muted">
        {node.validator ? (
          <span className="group flex items-center gap-1.5">
            <span title={node.validator}>{shortHash(node.validator)}</span>
            {/* Kept out of the flow until hover so 500 rows stay quiet. */}
            <CopyButton
              value={node.validator}
              label={`Copy validator address of ${node.name}`}
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            />
          </span>
        ) : node.nodeType === "validator" ? (
          /* An authority with no address means the node reports at verbosity
             0, where afg.authority_set is never sent — not that it has none. */
          <span title="Requires telemetry verbosity 1 or higher">{NO_VALUE}</span>
        ) : (
          NO_VALUE
        )}
      </div>
      <div className="num">{formatNumber(node.peers)}</div>
      <div className="num">{formatNumber(node.txcount)}</div>
      <div className="num font-medium text-accent">{formatHeight(node.best)}</div>
      <div className="text-muted">{shortHash(node.best?.hash)}</div>
      <div className="num">{formatMs(node.blockTime)}</div>
      <div className="num">{formatMs(node.propagationTime)}</div>
      <div className="num">{formatHeight(node.finalized)}</div>
      <div className="num text-muted">{formatAgo(node.lastBlockAt, now)}</div>
      <div className="font-sans text-muted">{formatLocation(node.geo)}</div>
    </div>
  );
});
