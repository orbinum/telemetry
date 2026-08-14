/**
 * Node list — the main view. The chain and its feed are owned by the layout,
 * so this only renders what the store already holds.
 */

import { NodeSearch } from "../components/NodeSearch";
import { NodeTable } from "../components/NodeTable";
import { EmptyState } from "../components/ui/EmptyState";
import { useHiddenCount, useNodeOrder, useQuery } from "../../stores/feedStore";

export function NodeListPage() {
  const order = useNodeOrder();
  const query = useQuery();
  const hidden = useHiddenCount();

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="font-sans text-xs text-muted">
          {order.length} {order.length === 1 ? "node" : "nodes"}
          {hidden > 0 && ` · ${hidden} hidden by filter`}
        </p>
        <NodeSearch />
      </div>

      {order.length === 0 ? (
        <EmptyState>
          {query === "" ? "No nodes reporting yet." : `No nodes match “${query}”.`}
        </EmptyState>
      ) : (
        <NodeTable />
      )}
    </>
  );
}
