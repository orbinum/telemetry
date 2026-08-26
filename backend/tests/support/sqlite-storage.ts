/**
 * A `SqlStorage` backed by real SQLite, for the Durable Object's own store.
 *
 * The alternative is a hand-written fake that string-matches each query and
 * reimplements it against a Map — which is how this was tested before, and
 * which proves the fake's SQL, not the adapter's. This runs the statements.
 *
 * `SqlStorage` is synchronous, and so is `node:sqlite`, so unlike the D1
 * double there is nothing to reconcile: `exec` returns a cursor whose
 * `toArray` is already sitting in memory.
 */

import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

/** An in-memory database presented through the SqlStorage interface. */
export function sqliteStorage(): SqlStorage {
  const db = new DatabaseSync(":memory:");

  return {
    exec(query: string, ...bindings: unknown[]) {
      const params = bindings as SQLInputValue[];
      // Positional `?` here, unlike D1's `?N` — this is the DO's own store and
      // the statements against it are written that way.
      if (/^\s*(SELECT|WITH)/i.test(query)) {
        const rows = db.prepare(query).all(...params);
        return { toArray: () => rows } as never;
      }
      db.prepare(query).run(...params);
      return { toArray: () => [] } as never;
    },
  } as unknown as SqlStorage;
}
