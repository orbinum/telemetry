/**
 * `ChainDirectoryStore` over the Durable Object's own SQLite — the only place
 * that touches the gateway's storage.
 *
 * Every chain a gateway has seen is recorded here so `GET /chains` can
 * populate the UI's picker even right after a deploy, when the in-memory
 * state of every DO is empty (plan §3.3). This is the sole thing in the
 * ingest path worth persisting: node state rebuilds itself from the wire in
 * seconds, a chain list does not.
 *
 * Entries expire. Without that the directory only ever grows: on the deployed
 * worker the allowlist bounds it, but a developer's local worker accumulates
 * a dead tab for every throwaway chain they ever ran, and each one looks as
 * current as the chain they are actually working on.
 */

import type { ChainDirectoryStore, ChainListing } from "../../app/ports/directory";

/** How long a chain stays listed after its last activity. */
export const CHAIN_TTL_MS = 10 * 60 * 1000;

/**
 * A row as SqlStorage types it. Private to this adapter: an index signature
 * over `SqlStorageValue` is a fact about the driver, and callers get the plain
 * `ChainListing` instead.
 */
interface ChainDirectoryRow extends Record<string, SqlStorageValue> {
  genesis: string;
  label: string;
  updated: number;
}

export class SqlChainDirectory implements ChainDirectoryStore {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS chains (" +
        "genesis TEXT PRIMARY KEY, label TEXT NOT NULL, updated INTEGER NOT NULL)",
    );
  }

  /**
   * Record (or refresh) a chain. The label follows the newest node's.
   *
   * Called on every routed message, not just on connect: a node that
   * connected hours ago and has been reporting since is the *most* current
   * chain there is, and must not age out from under itself.
   */
  record(genesisHash: string, label: string, now: number): void {
    this.sql.exec(
      "INSERT INTO chains (genesis, label, updated) VALUES (?, ?, ?) " +
        "ON CONFLICT(genesis) DO UPDATE SET label = excluded.label, updated = excluded.updated",
      genesisHash,
      label,
      now,
    );
  }

  /** Bump only the activity stamp, for messages that carry no chain label. */
  touch(genesisHash: string, now: number): void {
    this.sql.exec("UPDATE chains SET updated = ? WHERE genesis = ?", now, genesisHash);
  }

  /** Chains active within the TTL, most recently active first. */
  list(now: number, ttlMs: number = CHAIN_TTL_MS): ChainListing[] {
    return this.sql
      .exec<ChainDirectoryRow>(
        "SELECT genesis, label, updated FROM chains WHERE updated >= ? ORDER BY updated DESC",
        now - ttlMs,
      )
      .toArray();
  }

  /** Delete expired rows so the table does not grow without bound. */
  prune(now: number, ttlMs: number = CHAIN_TTL_MS): void {
    this.sql.exec("DELETE FROM chains WHERE updated < ?", now - ttlMs);
  }
}
