/** Sticky header with click-to-sort columns. */

import { ChevronDown, ChevronUp } from "lucide-react";
import { COLUMNS } from "./columns";
import { toggleSort, useSort } from "../../stores/feedStore";
import { cn } from "./ui/cn";

export function NodeTableHead() {
  const sort = useSort();

  return (
    <div className="node-grid-head node-grid-row">
      {COLUMNS.map((column, index) => {
        const active = sort.key === column.key;
        return (
          <div key={`${column.key}-${index}`} className={cn(column.numeric && "num")}>
            <button
              type="button"
              onClick={() => toggleSort(column.key)}
              title={column.title ?? `Sort by ${column.label}`}
              aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
              className={cn(active && "text-accent")}
            >
              {column.label}
              {active &&
                (sort.direction === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
