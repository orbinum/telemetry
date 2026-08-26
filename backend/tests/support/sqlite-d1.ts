/**
 * A `D1Database` backed by real SQLite, for tests that need the SQL executed
 * rather than recorded.
 *
 * The recording doubles elsewhere in `tests/db` pin *intent* — that a write is
 * an upsert on the bucket key, that a close goes out as one batch. They cannot
 * pin *effect*, because they never hand the SQL to a parser: a typo in the
 * thirty-line CTE in `readHourlyHistory` passes them and fails in production.
 * This runs the statements for real, against the schema in `migrations/`.
 *
 * `node:sqlite` is the whole dependency — it ships with Node, so the suite
 * still needs no Workers runtime and no native build.
 */

import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Where the real migrations live, relative to this file. */
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "migrations");

/**
 * Bind D1's `?N` placeholders.
 *
 * D1 numbers its parameters and takes them as positional arguments;
 * `node:sqlite` rejects that outright ("column index out of range") and wants
 * an object keyed by the number instead. This is the one real translation
 * between the two drivers — everything else is the same SQLite.
 */
function named(params: unknown[]): Record<string, SQLInputValue> {
  return Object.fromEntries(params.map((value, i) => [String(i + 1), value as SQLInputValue]));
}

interface Prepared {
  sql: string;
  params: unknown[];
}

/**
 * Load every migration in order.
 *
 * Read from disk rather than duplicated here: a migration the code has not
 * caught up with then fails the tests instead of passing them.
 */
function applyMigrations(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

export interface SqliteD1 {
  db: D1Database;
  /** Escape hatch for arranging fixtures and asserting on rows. */
  raw: DatabaseSync;
}

/** A migrated in-memory database presented through the D1 interface. */
export function sqliteD1(): SqliteD1 {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);

  const run = (stmt: Prepared) => {
    const result = sqlite.prepare(stmt.sql).run(named(stmt.params));
    return {
      success: true,
      // D1 reports affected rows here; `closeOrphans` returns it.
      meta: { changes: Number(result.changes) },
    };
  };

  const statement = (sql: string) => {
    const stmt: Prepared = { sql, params: [] };
    const bound = {
      bind: (...params: unknown[]) => {
        stmt.params = params;
        return bound;
      },
      run: () => Promise.resolve(run(stmt)),
      all: () => Promise.resolve({ results: sqlite.prepare(sql).all(named(stmt.params)) }),
      first: () => {
        const row = sqlite.prepare(sql).get(named(stmt.params));
        // D1 returns null for an empty result, not undefined.
        return Promise.resolve(row ?? null);
      },
      __stmt: stmt,
    };
    return bound;
  };

  const db = {
    prepare: statement,
    /**
     * D1's `batch` is one round trip *and* one transaction. Reproducing the
     * transaction is the point: `pruneHistory` relies on it so a rollup can
     * never be committed without its prune, and a test that ran the two
     * statements loose would not notice if that broke.
     */
    batch: (statements: { __stmt: Prepared }[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => run(s.__stmt));
        sqlite.exec("COMMIT");
        return Promise.resolve(results);
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  return { db, raw: sqlite };
}
