/**
 * `SessionRepository` over D1.
 *
 * As with history, the statements live in `db/node-sessions` and are tested
 * there against real SQLite; this binds them to a database and nothing else.
 */

import {
  closeOrphanSessions,
  closeSessions,
  openSession,
  pruneSessions,
  readLastValidatorAddress,
  readSessions,
  readUptime,
  recordValidatorAddress,
} from "../../db/node-sessions";
import type { NodeState } from "../../domain/node-state";
import type {
  NodeSession,
  NodeUptime,
  SessionDeparture,
  SessionRepository,
} from "../../ports/persistence";

export class D1SessionRepository implements SessionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  open(genesis: string, node: NodeState): Promise<void> {
    return openSession(this.db, genesis, node);
  }

  recordValidatorAddress(
    genesis: string,
    networkId: string,
    connectedAt: number,
    address: string,
  ): Promise<void> {
    return recordValidatorAddress(this.db, genesis, networkId, connectedAt, address);
  }

  readLastValidatorAddress(genesis: string, networkId: string): Promise<string | undefined> {
    return readLastValidatorAddress(this.db, genesis, networkId);
  }

  close(genesis: string, departures: SessionDeparture[], now: number): Promise<void> {
    return closeSessions(this.db, genesis, departures, now);
  }

  closeOrphans(genesis: string, liveConnectedAt: number[], fallback: number): Promise<number> {
    return closeOrphanSessions(this.db, genesis, liveConnectedAt, fallback);
  }

  readUptime(genesis: string, from: number, now: number): Promise<NodeUptime[]> {
    return readUptime(this.db, genesis, from, now);
  }

  readSessions(genesis: string, networkId: string, from: number): Promise<NodeSession[]> {
    return readSessions(this.db, genesis, networkId, from);
  }

  prune(now: number, retentionMs: number, minSessionMs?: number): Promise<void> {
    return pruneSessions(this.db, now, retentionMs, minSessionMs);
  }
}
