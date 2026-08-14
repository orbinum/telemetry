/**
 * Virtualized node list.
 *
 * `@tanstack/react-virtual` renders only the rows in view, so the DOM stays
 * at ~20 rows whether the chain has 50 nodes or 5.000 (plan §8, point 4).
 */

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { NodeRow } from "./NodeRow";
import { NodeTableHead } from "./NodeTableHead";
import { useNodeOrder } from "../../stores/feedStore";
import { useTick } from "../hooks/useTick";

/**
 * Row height in px — fixed, so the virtualizer needs no measurement pass.
 * Must match `--node-row-height` in components.css: rows are absolutely
 * positioned, so a mismatch leaves the container scrollable even when a
 * single row is showing.
 */
const ROW_HEIGHT = 36;

/** Rows rendered beyond the viewport, to hide scroll latency. */
const OVERSCAN = 12;

export function NodeTable() {
  const order = useNodeOrder();
  const now = useTick();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  return (
    <div className="glass-card overflow-x-auto">
      <div className="node-grid">
        <NodeTableHead />
        <div
          ref={scrollRef}
          className="node-grid-body overflow-y-auto"
          style={{ maxHeight: "calc(100dvh - 22rem)" }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <NodeRow
                key={order[item.index]}
                id={order[item.index]}
                now={now}
                top={item.start}
                height={item.size}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
