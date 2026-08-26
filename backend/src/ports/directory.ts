/**
 * The chain directory: which chains have been seen recently, so the UI's
 * picker is populated even right after a deploy, when live state is empty.
 */

/** A chain the directory knows about. */
export interface ChainListing {
  genesis: string;
  label: string;
  /** Wall-clock ms of the last activity seen for this chain. */
  updated: number;
}

/**
 * Deliberately synchronous.
 *
 * The store is process-local by definition — a Durable Object's own SQLite
 * lives in the isolate, and a single-process host would back this with a Map —
 * so there is nothing to await. Making it async to accommodate a store that
 * does not exist would put a microtask on every routed frame, since
 * `MessageRouter.touchChain` runs per node message, and would turn a
 * fire-and-forget stamp into a floating promise.
 *
 * If a host ever needs a remote directory, it needs a different port, not an
 * await on this one.
 */
export interface ChainDirectoryStore {
  /** Record or refresh a chain, following the newest node's label. */
  record(genesisHash: string, label: string, now: number): void;
  /** Bump only the activity stamp, for messages carrying no label. */
  touch(genesisHash: string, now: number): void;
  /** Chains active within the TTL, most recently active first. */
  list(now: number, ttlMs?: number): ChainListing[];
  /** Drop expired entries so the directory stays bounded. */
  prune(now: number, ttlMs?: number): void;
}
