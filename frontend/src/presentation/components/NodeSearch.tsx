/**
 * Search box — filters the node list by name or validator address.
 *
 * The count of what the filter hides is rendered by the caller, next to the
 * node count it qualifies: it is a fact about the list, not about the input.
 */

import { Search, X } from "lucide-react";
import { setQuery, useQuery } from "../../stores/feedStore";

export function NodeSearch() {
  const query = useQuery();

  return (
    <div className="relative w-full sm:w-72">
      <Search
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by name, type or address…"
        aria-label="Filter nodes by name or validator"
        className="search-input h-9 w-full rounded-md border border-border bg-surface pl-9 pr-9 font-sans text-sm text-text transition-colors placeholder:text-muted hover:border-muted focus:border-accent focus:outline-none"
      />
      {query !== "" && (
        <button
          onClick={() => setQuery("")}
          aria-label="Clear filter"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted transition-colors hover:bg-overlay-hover hover:text-accent"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
