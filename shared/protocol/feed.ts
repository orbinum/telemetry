/**
 * Server→browser feed protocol. Orbinum writes both sides, so this is plain
 * JSON with named keys (plan §5): the WebSocket's permessage-deflate eats the
 * repeated key overhead, and there is no opcode table to keep in sync.
 *
 * Design choice vs the plan's sketch: `upd` carries whole FeedNode objects
 * with **upsert** semantics instead of positional field deltas — a client
 * that sees an unknown id inserts it, so no separate `add` message exists.
 * Removal is explicit via `rm`.
 *
 * This file is the wire contract shared by backend and frontend — keep it
 * dependency-free.
 */

// ─── Wire shapes ─────────────────────────────────────────────────────────────

export interface FeedBlock {
  hash: string;
  height: number;
}

export interface FeedGeo {
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

/** One node row, as the UI renders it. */
export interface FeedNode {
  /** Numeric id, unique within a chain feed session. */
  id: number;
  name: string;
  implementation: string;
  version: string;
  /**
   * Whether the node runs as an authority — sent by every client on connect,
   * at any verbosity.
   *
   * The reference implementation has no such field: it derives the role from
   * `validator` alone, which works there because Polkadot and Kusama report at
   * verbosity 1 or above, where the address always arrives. Orbinum's nodes
   * report at 0, where it never does, so reading the address alone made every
   * validator look like a full node.
   */
  authority?: boolean;
  /** The authority's address. Only arrives via `afg.authority_set`, at verbosity ≥ 1. */
  validator?: string;
  /** Unix ms (string on the node wire, number here). */
  startupTime?: number;
  peers?: number;
  txcount?: number;
  best?: FeedBlock;
  /** ms between this node's last two best blocks. */
  blockTime?: number;
  /** ms behind the first reporter of the current height. 0 = first. */
  propagationTime?: number;
  /** Wall-clock ms when the node last reported a best block. */
  lastBlockAt?: number;
  finalized?: FeedBlock;
  stale: boolean;
  geo?: FeedGeo;
}

/** Chain-level aggregates. */
export interface FeedChain {
  genesisHash: string;
  /** Chain label as nodes report it (e.g. "Orbinum Testnet"). */
  label: string;
  nodeCount: number;
  best?: FeedBlock;
  finalized?: FeedBlock;
  averageBlockTime?: number;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Snapshot chunk on connect; 100 nodes per frame, `done` on the last chunk. */
export interface FeedInit {
  t: "init";
  chain: FeedChain;
  nodes: FeedNode[];
  done: boolean;
}

/** Batched upserts (100 ms batches). Unknown ids are inserts. */
export interface FeedUpdate {
  t: "upd";
  n: FeedNode[];
}

/** Nodes that left (disconnect or 60s reaper). */
export interface FeedRemove {
  t: "rm";
  n: number[];
}

/** Chain aggregates changed. */
export interface FeedChainUpdate {
  t: "chain";
  c: FeedChain;
}

export type FeedMessage = FeedInit | FeedUpdate | FeedRemove | FeedChainUpdate;

// ─── Parsing (browser side) ──────────────────────────────────────────────────

const TAGS = new Set(["init", "upd", "rm", "chain"]);

/** Parse one feed frame; null for anything that isn't a known message. */
export function parseFeedMessage(raw: string): FeedMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return null;
  const t = (msg as { t?: unknown }).t;
  if (typeof t !== "string" || !TAGS.has(t)) return null;
  return msg as FeedMessage;
}

// ─── Directory ───────────────────────────────────────────────────────────────

/** One row of GET /chains — enough for the UI's chain picker. */
export interface ChainDirectoryEntry {
  genesisHash: string;
  label: string;
  /** Wall-clock ms of the last node activity seen by a gateway. */
  updatedAt: number;
}
