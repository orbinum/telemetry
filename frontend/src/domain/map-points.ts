/**
 * Node positions for the map.
 *
 * No projection here any more: MapLibre owns that, so this file's whole job is
 * grouping nodes that share a location and counting what is there.
 *
 * Pure, like `statistics.ts`: the page calls this once per flush, never during
 * render.
 */

import type { FeedNode } from "../../../shared/protocol/feed";

/** One marker: a place, and the nodes reporting from it. */
export interface MapPoint {
  /** Stable across renders — the label doubles as the React key. */
  label: string;
  latitude: number;
  longitude: number;
  total: number;
  validators: number;
  stale: number;
}

/** Round to ~1km so two nodes in one datacenter share a marker. */
function keyOf(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

function labelOf(node: FeedNode): string {
  const { city, country } = node.geo ?? {};
  if (city && country) return `${city}, ${country}`;
  return city ?? country ?? "Unknown location";
}

/**
 * Group nodes by location.
 *
 * Nodes without coordinates are dropped rather than parked at (0,0), which is
 * in the Atlantic and would read as a real cluster. The page reports how many
 * were left out, so the map never quietly under-counts.
 */
export function computeMapPoints(nodes: FeedNode[]): MapPoint[] {
  const points = new Map<string, MapPoint>();

  for (const node of nodes) {
    const { latitude, longitude } = node.geo ?? {};
    if (latitude === undefined || longitude === undefined) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const key = keyOf(latitude, longitude);
    const point = points.get(key) ?? {
      label: labelOf(node),
      latitude,
      longitude,
      total: 0,
      validators: 0,
      stale: 0,
    };

    point.total++;
    if (node.nodeType === "validator") point.validators++;
    if (node.stale) point.stale++;
    points.set(key, point);
  }

  // Biggest last: MapLibre draws in feature order, so the largest marker ends
  // up on top of the small ones it overlaps rather than hidden under them.
  return [...points.values()].sort((a, b) => a.total - b.total);
}

/** Nodes the map cannot place, which the page states rather than hides. */
export function countUnplaceable(nodes: FeedNode[]): number {
  return nodes.filter(
    (node) => node.geo?.latitude === undefined || node.geo?.longitude === undefined,
  ).length;
}
