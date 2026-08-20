/**
 * Which nodes the table shows, and in what order.
 *
 * Pure by design: no socket, no store, no React. The feed store calls this
 * once per flush and never during render (plan §8, point 5) — at 500 nodes a
 * filter + sort is ~50 µs, which is nothing once per frame and everything
 * once per row.
 */

import { STORAGE_KEYS, readStoredJson, writeStoredJson } from "../utils/storage";
import type { FeedNode } from "../../../shared/protocol/feed";

/** Columns the table can sort by. */
export type SortKey =
  | "name"
  | "implementation"
  | "nodeType"
  | "validator"
  | "peers"
  | "txcount"
  | "best"
  | "blockTime"
  | "propagationTime"
  | "finalized"
  | "lastBlockAt"
  | "location";

export type SortDirection = "asc" | "desc";

export interface Sort {
  key: SortKey;
  direction: SortDirection;
}

/** Height descending is what an operator wants to see first. */
export const DEFAULT_SORT: Sort = { key: "best", direction: "desc" };

// ─── Filtering ───────────────────────────────────────────────────────────────

/** True when the node matches an already-normalized (lowercased) query. */
export function matchesQuery(node: FeedNode, query: string): boolean {
  if (query === "") return true;
  return (
    node.name.toLowerCase().includes(query) ||
    (node.validator?.toLowerCase().includes(query) ?? false) ||
    node.nodeType.includes(query)
  );
}

/** Normalize raw user input into the form matchesQuery expects. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** Text used when sorting by location; matches what the column renders. */
function locationOf(node: FeedNode): string {
  const geo = node.geo;
  if (geo === undefined) return "";
  if (geo.city && geo.country) return `${geo.city}, ${geo.country}`;
  return geo.city ?? geo.country ?? "";
}

function textValue(node: FeedNode, key: SortKey): string | undefined {
  switch (key) {
    case "name":
      return node.name;
    case "implementation":
      return `${node.implementation} ${node.version}`;
    case "nodeType":
      return node.nodeType;
    case "validator":
      return node.validator;
    case "location":
      return locationOf(node) || undefined;
    default:
      return undefined;
  }
}

function numericValue(node: FeedNode, key: SortKey): number | undefined {
  switch (key) {
    case "peers":
      return node.peers;
    case "txcount":
      return node.txcount;
    case "best":
      return node.best?.height;
    case "blockTime":
      return node.blockTime;
    case "propagationTime":
      return node.propagationTime;
    case "finalized":
      return node.finalized?.height;
    case "lastBlockAt":
      return node.lastBlockAt;
    default:
      return undefined;
  }
}

/**
 * Compare two nodes by one column.
 *
 * Missing values always sort last regardless of direction — a node with no
 * block reported is not "the smallest", it is unknown, and burying it under
 * real data on both directions is what an operator expects.
 */
function compare(a: FeedNode, b: FeedNode, sort: Sort): number {
  const factor = sort.direction === "asc" ? 1 : -1;

  const textA = textValue(a, sort.key);
  if (textA !== undefined || textValue(b, sort.key) !== undefined) {
    const textB = textValue(b, sort.key);
    if (textA === undefined) return 1;
    if (textB === undefined) return -1;
    return factor * textA.localeCompare(textB);
  }

  const numA = numericValue(a, sort.key);
  const numB = numericValue(b, sort.key);
  if (numA === undefined && numB === undefined) return 0;
  if (numA === undefined) return 1;
  if (numB === undefined) return -1;
  return factor * (numA - numB);
}

/** Ids of the nodes to display: filtered by query, then sorted. */
export function computeOrder(
  nodes: Map<number, FeedNode>,
  query: string,
  sort: Sort = DEFAULT_SORT,
): number[] {
  return (
    [...nodes.values()]
      .filter((node) => matchesQuery(node, query))
      // Name is the tiebreaker everywhere, so the order is stable frame to frame.
      .sort((a, b) => compare(a, b, sort) || a.name.localeCompare(b.name))
      .map((node) => node.id)
  );
}

/** Clicking a column toggles direction; a new column starts at its natural one. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  // Text reads best A→Z; numbers read best largest-first.
  const isText =
    key === "name" ||
    key === "implementation" ||
    key === "nodeType" ||
    key === "validator" ||
    key === "location";
  return { key, direction: isText ? "asc" : "desc" };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const SORT_KEYS = new Set<string>([
  "name",
  "implementation",
  "nodeType",
  "validator",
  "peers",
  "txcount",
  "best",
  "blockTime",
  "propagationTime",
  "finalized",
  "lastBlockAt",
  "location",
]);

/** Narrow an unknown stored value to a Sort, or reject it. */
function parseSort(value: unknown): Sort | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { key, direction } = value as Partial<Sort>;
  if (typeof key !== "string" || !SORT_KEYS.has(key)) return undefined;
  if (direction !== "asc" && direction !== "desc") return undefined;
  return { key: key as SortKey, direction };
}

/** The stored sort, or the default when there is none or it is unusable. */
export function loadSort(): Sort {
  return readStoredJson(STORAGE_KEYS.sort, parseSort) ?? DEFAULT_SORT;
}

export function saveSort(sort: Sort): void {
  writeStoredJson(STORAGE_KEYS.sort, sort);
}
