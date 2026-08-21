/**
 * Feed store — the React-facing view of the FeedClient's state.
 *
 * Rows subscribe per node id (`useNode`), never to the whole Map, so a delta
 * for one node re-renders one row (plan §8, point 3). Filtering and sorting
 * happen here on flush, never in render.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { computeOrder, loadSort, nextSort, normalizeQuery, saveSort } from "../domain/node-order";
import { FeedClient } from "../services/feed-client";
import type { Sort, SortKey } from "../domain/node-order";
import type { FeedStatus } from "../services/feed-client";
import type { FeedChain, FeedNode } from "../../../shared/protocol/feed";

interface FeedState {
  nodes: Map<number, FeedNode>;
  chain?: FeedChain;
  status: FeedStatus;
  /** Add to `Date.now()` to read the server's clock. See `useTick`. */
  clockOffset: number;
  /** Node ids in display order, recomputed once per flush, not per render. */
  order: number[];
  /** Case-insensitive substring matched against name and validator. */
  query: string;
  /** How many nodes the current query hides (0 when the query is empty). */
  hiddenCount: number;
  sort: Sort;
}

/**
 * The store itself. Components use the selectors below; `getState` is here
 * for the non-React callers in this file and for tests, which assert on the
 * state rather than on a rendered tree.
 */
export const useFeedStore = create<FeedState>(() => ({
  nodes: new Map(),
  chain: undefined,
  status: "connecting",
  clockOffset: 0,
  order: [],
  query: "",
  hiddenCount: 0,
  sort: loadSort(),
}));

let client: FeedClient | undefined;
let unsubscribe: (() => void) | undefined;

/** Recompute the visible order from the current nodes, query and sort. */
function reorder(nodes: Map<number, FeedNode>): Pick<FeedState, "order" | "hiddenCount"> {
  const { query, sort } = useFeedStore.getState();
  const order = computeOrder(nodes, normalizeQuery(query), sort);
  return { order, hiddenCount: nodes.size - order.length };
}

/** Point the store at a chain on a given worker. */
export function connectFeed(genesisHash: string, wsBase: string): void {
  disconnectFeed();
  useFeedStore.setState({
    nodes: new Map(),
    chain: undefined,
    status: "connecting",
    clockOffset: 0,
    order: [],
    hiddenCount: 0,
  });

  client = new FeedClient(genesisHash, wsBase);
  unsubscribe = client.subscribe((snapshot) => {
    useFeedStore.setState({
      nodes: snapshot.nodes,
      chain: snapshot.chain,
      status: snapshot.status,
      clockOffset: snapshot.clockOffset,
      ...reorder(snapshot.nodes),
    });
  });
  client.connect();
}

export function disconnectFeed(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  client?.disconnect();
  client = undefined;
}

/**
 * Drop the socket *and* everything it published.
 *
 * Used when switching networks: leaving the previous network's nodes on
 * screen under the new network's name is worse than showing nothing, because
 * the reading looks live and is wrong. The query and sort survive — those are
 * the user's preferences, not the network's data.
 */
export function resetFeed(): void {
  disconnectFeed();
  useFeedStore.setState({
    nodes: new Map(),
    chain: undefined,
    status: "connecting",
    clockOffset: 0,
    order: [],
    hiddenCount: 0,
  });
}

/** Update the search query and re-filter the current snapshot immediately. */
export function setQuery(raw: string): void {
  useFeedStore.setState({ query: raw });
  useFeedStore.setState(reorder(useFeedStore.getState().nodes));
}

/** Toggle sorting on a column; the choice survives reloads. */
export function toggleSort(key: SortKey): void {
  const sort = nextSort(useFeedStore.getState().sort, key);
  saveSort(sort);
  useFeedStore.setState({ sort });
  useFeedStore.setState(reorder(useFeedStore.getState().nodes));
}

// ─── Selectors ───────────────────────────────────────────────────────────────

/** One row's data. The selector reads a single entry, not the whole Map. */
export function useNode(id: number): FeedNode | undefined {
  return useFeedStore((s) => s.nodes.get(id));
}

export function useNodeOrder(): number[] {
  return useFeedStore(useShallow((s) => s.order));
}

export function useChain(): FeedChain | undefined {
  return useFeedStore((s) => s.chain);
}

export function useFeedStatus(): FeedStatus {
  return useFeedStore((s) => s.status);
}

/** Difference between the server's clock and this browser's, in ms. */
export function useClockOffset(): number {
  return useFeedStore((s) => s.clockOffset);
}

export function useQuery(): string {
  return useFeedStore((s) => s.query);
}

export function useHiddenCount(): number {
  return useFeedStore((s) => s.hiddenCount);
}

export function useSort(): Sort {
  return useFeedStore(useShallow((s) => s.sort));
}

/** All visible nodes — for aggregate views (stats), not for the table. */
export function useVisibleNodes(): FeedNode[] {
  return useFeedStore(
    useShallow((s) => s.order.map((id) => s.nodes.get(id)).filter((n): n is FeedNode => !!n)),
  );
}
