/** Search box — filters the node list by name or validator address. */

import { Search, X } from "lucide-react";
import { setQuery, useHiddenCount, useQuery } from "../../stores/feedStore";

export function NodeSearch() {
  const query = useQuery();
  const hidden = useHiddenCount();

  return (
    <div className="relative w-full sm:w-80">
      <Search
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by name or validator…"
        aria-label="Filter nodes by name or validator"
        className="search-input w-full border border-border bg-surface py-1.5 pl-9 pr-8 font-sans text-sm text-text placeholder:text-muted focus:border-muted focus:outline-none"
      />
      {query !== "" && (
        <button
          onClick={() => setQuery("")}
          aria-label="Clear filter"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-accent"
        >
          <X size={14} />
        </button>
      )}
      {query !== "" && hidden > 0 && (
        <span className="absolute -bottom-5 left-1 font-sans text-[11px] text-muted">
          {hidden} hidden
        </span>
      )}
    </div>
  );
}
