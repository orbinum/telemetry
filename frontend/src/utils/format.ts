/**
 * Display formatting for the node table.
 *
 * Every function here answers the same question — what does a reader see when
 * a node has not reported this field? — with the same answer, so a row never
 * mixes two spellings of "no data".
 */

/** Shown wherever a value is absent. An em dash reads as "nothing here". */
export const NO_VALUE = "—";

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return NO_VALUE;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compact relative time, e.g. "4s ago". */
export function formatAgo(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined || timestamp === 0) return NO_VALUE;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function shortHash(hash: string | undefined): string {
  if (hash === undefined) return NO_VALUE;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function formatNumber(value: number | undefined): string {
  return value === undefined ? NO_VALUE : value.toLocaleString("en-US");
}

/** Block height with its `#` prefix, or the absent marker. */
export function formatHeight(block: { height: number } | undefined): string {
  return block === undefined ? NO_VALUE : `#${formatNumber(block.height)}`;
}

export function formatLocation(geo: { city?: string; country?: string } | undefined): string {
  if (geo === undefined) return NO_VALUE;
  if (geo.city && geo.country) return `${geo.city}, ${geo.country}`;
  return geo.city ?? geo.country ?? NO_VALUE;
}
