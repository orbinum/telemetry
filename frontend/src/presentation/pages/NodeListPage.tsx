/**
 * Node list — the main view. The chain and its feed are owned by the layout,
 * so this only renders what the store already holds.
 */

import { NodeSearch } from "../components/NodeSearch";
import { NodeTable } from "../components/NodeTable";
import { EmptyState, LoadingState } from "../components/ui/EmptyState";
import {
  setQuery,
  useFeedStatus,
  useHiddenCount,
  useNodeOrder,
  useQuery,
} from "../../stores/feedStore";

export function NodeListPage() {
  const order = useNodeOrder();
  const query = useQuery();
  const hidden = useHiddenCount();
  const status = useFeedStatus();

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="order-2 font-sans text-xs text-muted sm:order-1">
          {order.length} {order.length === 1 ? "node" : "nodes"}
          {hidden > 0 && (
            <>
              {" · "}
              <button
                onClick={() => setQuery("")}
                className="underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
              >
                {hidden} hidden by filter
              </button>
            </>
          )}
        </p>
        <div className="order-1 sm:order-2">
          <NodeSearch />
        </div>
      </div>

      {/* An empty list means two different things depending on the socket: no
          nodes, or no answer yet. Only the first is worth stating. A filter
          that matches nothing is always the user's own doing, so that message
          stands regardless of connection state. */}
      {order.length === 0 && query === "" && status === "connecting" ? (
        <LoadingState>Connecting to the telemetry feed…</LoadingState>
      ) : order.length === 0 ? (
        <EmptyState>
          {query === "" ? "No nodes reporting yet." : `No nodes match “${query}”.`}
        </EmptyState>
      ) : (
        <NodeTable />
      )}
    </>
  );
}
