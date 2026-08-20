/**
 * Shown when the map chunk still will not load after lazyWithReload already
 * spent its one reload. Staleness is ruled out by then, so the remaining
 * cause is something refusing the request — an ad blocker or a privacy
 * extension matching on the request, which the reader can fix and we cannot.
 */

import { ErrorState } from "../components/ui/EmptyState";

export function ChunkLoadError() {
  return (
    <ErrorState hint="An ad blocker or privacy extension is the usual cause. Allow this site and reload.">
      The map could not be loaded.
    </ErrorState>
  );
}
