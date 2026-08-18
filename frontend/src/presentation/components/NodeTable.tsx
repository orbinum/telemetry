/**
 * Node list.
 *
 * Every node renders — the list has no inner scroll and no row cap, so a
 * chain with 100 validators shows 100 rows and the page itself scrolls.
 */

import { NodeRow } from "./NodeRow";
import { NodeTableHead } from "./NodeTableHead";
import { useNodeOrder } from "../../stores/feedStore";
import { useTick } from "../hooks/useTick";

export function NodeTable() {
  const order = useNodeOrder();
  const now = useTick();

  return (
    <div className="glass-card overflow-x-auto">
      <div className="node-grid">
        <NodeTableHead />
        <div className="node-grid-body">
          {order.map((id) => (
            <NodeRow key={id} id={id} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}
