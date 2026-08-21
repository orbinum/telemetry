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

/** The role a node plays, as the table reports it. */
export type NodeType = "validator" | "rpc";

/** Self-reported hardware. Every field is optional: nodes may omit any of it. */
export interface FeedSysInfo {
  cpu?: string;
  /** Bytes of RAM. */
  memory?: number;
  coreCount?: number;
  linuxKernel?: string;
  linuxDistro?: string;
  isVirtualMachine?: boolean;
}

/** Benchmark scores from `sysinfo.hwbench`, in the node's own units. */
export interface FeedHwBench {
  cpuHashrateScore: number;
  memoryMemcpyScore: number;
  diskSequentialWriteScore?: number;
  diskRandomWriteScore?: number;
  parallelCpuHashrateScore?: number;
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
  /**
   * What the node is, for the Type column: `authority` decides it, and every
   * non-authority is an RPC node. The protocol has no RPC signal of its own,
   * so this is Orbinum's own two-role split rather than something the node
   * reports.
   */
  nodeType: NodeType;
  /** The authority's address. Only arrives via `afg.authority_set`, at verbosity ≥ 1. */
  validator?: string;
  /**
   * The node's libp2p PeerId, as it reports it.
   *
   * Unlike `id`, which is a counter that restarts with the Durable Object,
   * this is stable across restarts and redeploys for any node whose key is
   * fixed — which is every Orbinum node, since node-deploy pins `*_NODE_KEY`.
   * That makes it the identity a per-node history can be keyed on.
   *
   * Self-reported and unverified: `/submit` is public and nothing proves the
   * sender holds the matching private key. Treat it as a label, never as
   * authentication.
   */
  networkId?: string;
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

  // ── Immutable, sent once ───────────────────────────────────────────────────
  // Fixed for the life of a node's session, so they ride the `init` and the
  // first `upd` that introduces the node, and are omitted from later deltas.
  // Upsert semantics keep them: the client merges, so an absent key means
  // "unchanged", never "gone". Re-sending them each 100 ms batch would add
  // ~57% to the hot frame for data that cannot have changed.

  targetOs?: string;
  targetArch?: string;
  targetEnv?: string;
  sysinfo?: FeedSysInfo;
  /**
   * Arrives shortly *after* connect, so a node can appear before its scores do.
   * That later arrival is itself a change, and ships as a normal delta.
   */
  hwbench?: FeedHwBench;
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

/**
 * Wire format version. Lets a tab left open across a deploy notice it is
 * reading frames it no longer understands, instead of rendering them wrong.
 *
 * Bump when a field is removed or reinterpreted; adding an optional one does
 * not count, since older clients ignore what they do not read.
 */
export const FEED_VERSION = 2;

/** Snapshot chunk on connect; 100 nodes per frame, `done` on the last chunk. */
export interface FeedInit {
  t: "init";
  /** `FEED_VERSION` as the server compiled it. */
  v: number;
  /**
   * The server's clock, so the browser can correct its own before rendering
   * "N seconds ago" against server-stamped timestamps. Includes one-way
   * latency, which is well under what these labels resolve.
   */
  serverTime: number;
  chain: FeedChain;
  nodes: FeedNode[];
  done: boolean;
}

/**
 * Batched upserts (100 ms batches). Unknown ids are inserts.
 *
 * **Merged, not replaced**: a delta carries only what changed, so a key the
 * frame omits keeps its previous value. Overwriting the row wholesale would
 * drop the immutable fields that only ever ship once.
 */
export interface FeedUpdate {
  t: "upd";
  n: FeedNode[];
}

/**
 * Chart series, on their own slower cadence.
 *
 * Four bounded 20-point series per node, which is ~1.4 kB of the ~2.5 kB a
 * fully-populated node weighs — putting them in the 100 ms batch tripled the
 * hot frame. They are moving averages over the last 20 intervals, so a 5 s
 * refresh loses nothing a sparkline could show.
 */
export interface FeedSeries {
  t: "series";
  n: FeedNodeSeries[];
}

export interface FeedNodeSeries {
  id: number;
  /** Bytes/s, oldest first. Same index across all four arrays. */
  upload: number[];
  download: number[];
  usedStateCacheSize: number[];
  /** Wall-clock ms each sample was taken, for the x axis. */
  chartStamps: number[];
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

export type FeedMessage =
  | FeedInit
  | FeedUpdate
  | FeedRemove
  | FeedChainUpdate
  | FeedSeries;

// ─── Parsing (browser side) ──────────────────────────────────────────────────

const TAGS = new Set(["init", "upd", "rm", "chain", "series"]);

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
