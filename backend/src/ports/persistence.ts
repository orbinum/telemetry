/**
 * Long-lived storage: chain history and node sessions.
 *
 * These are the current `db/` functions with the database argument curried
 * away. The SQL behind them is plain SQLite and would survive a move to
 * another driver unchanged; what would not survive is the driver itself, which
 * is exactly the seam these interfaces name.
 *
 * Deliberately not a generic query or SQL port. A port that takes SQL strings
 * is not a boundary, it is the same coupling with an interface in front of it:
 * the point is that a caller cannot tell whether the rows came from D1, from a
 * local file, or from Postgres.
 */

import type { ChainSnapshot, Histogram } from "../domain/chain-snapshot";
import type { NodeState } from "../domain/node-state";

/** One history point, as the API returns it. */
export interface ChainHistoryPoint {
  bucket: number;
  nodeCount: number;
  authorityCount: number;
  staleCount: number;
  bestHeight?: number;
  finalizedHeight?: number;
  finalityLag?: number;
  averageBlockTimeMs?: number;
  versions: Histogram;
}

/** A session, open if `disconnectedAt` is absent. */
export interface NodeSession {
  networkId: string;
  genesis: string;
  connectedAt: number;
  disconnectedAt?: number;
  name?: string;
  version?: string;
  implementation?: string;
  isAuthority: boolean;
  country?: string;
  validator?: string;
}

/** Uptime for one node over a window, derived from its sessions. */
export interface NodeUptime {
  networkId: string;
  name?: string;
  version?: string;
  isAuthority: boolean;
  /** Milliseconds connected within the window. */
  uptimeMs: number;
  /** Sessions started in the window — a high count is a flapping node. */
  sessions: number;
  lastSeen: number;
}

/** One node that left, identified as its session row is. */
export interface SessionDeparture {
  networkId: string;
  connectedAt: number;
}

/**
 * Aggregated chain history — one row per chain per minute, rolled up to hours
 * once the raw buckets age out.
 */
export interface HistoryRepository {
  writeSnapshot(snapshot: ChainSnapshot): Promise<void>;
  readHistory(genesisHash: string, from: number): Promise<ChainHistoryPoint[]>;
  readHourlyHistory(genesisHash: string, from: number): Promise<ChainHistoryPoint[]>;
  prune(now: number, retentionMs?: number): Promise<void>;
}

/** One row per continuous connection, which is what uptime is derived from. */
export interface SessionRepository {
  open(genesis: string, node: NodeState): Promise<void>;
  recordValidatorAddress(
    genesis: string,
    networkId: string,
    connectedAt: number,
    address: string,
  ): Promise<void>;
  readLastValidatorAddress(genesis: string, networkId: string): Promise<string | undefined>;
  close(genesis: string, departures: SessionDeparture[], now: number): Promise<void>;
  /**
   * Close sessions a previous owner of this chain left open, sparing the ones
   * whose `connected_at` is listed as live. Returns how many were closed.
   */
  closeOrphans(genesis: string, liveConnectedAt: number[], fallback: number): Promise<number>;
  readUptime(genesis: string, from: number, now: number): Promise<NodeUptime[]>;
  readSessions(genesis: string, networkId: string, from: number): Promise<NodeSession[]>;
  prune(now: number, retentionMs: number, minSessionMs?: number): Promise<void>;
}
