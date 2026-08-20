/**
 * History persistence tests.
 *
 * These use a minimal D1 stand-in that records the SQL and the bound
 * parameters rather than executing them: what matters here is the contract
 * with the database — that the write is an upsert on the bucket key, that
 * histograms are serialized, and that a row comes back mapped to camelCase.
 * The SQL itself is exercised end-to-end against a real local D1 in the
 * verification steps, which is where a syntax error would surface.
 */

import { describe, expect, it, vi } from "vitest";
import {
  pruneHistory,
  readHistory,
  readHourlyHistory,
  writeSnapshot,
} from "../../src/db/chain-history";
import type { ChainSnapshot } from "../../src/domain/chain-snapshot";

const GENESIS = "0x" + "ab".repeat(32);

interface Recorded {
  sql: string;
  params: unknown[];
}

/** A D1Database double that records statements and replays canned rows. */
function fakeDb(rows: Record<string, unknown>[] = []) {
  const calls: Recorded[] = [];
  const batches: Recorded[][] = [];

  const statement = (sql: string) => {
    const record: Recorded = { sql, params: [] };
    const bound = {
      bind: (...params: unknown[]) => {
        record.params = params;
        return bound;
      },
      run: () => {
        calls.push(record);
        return Promise.resolve({ success: true });
      },
      all: () => {
        calls.push(record);
        return Promise.resolve({ results: rows });
      },
      __record: record,
    };
    return bound;
  };

  const db = {
    prepare: vi.fn(statement),
    batch: (statements: { __record: Recorded }[]) => {
      batches.push(statements.map((s) => s.__record));
      return Promise.resolve([]);
    },
  } as unknown as D1Database;

  return { db, calls, batches };
}

function snapshot(overrides: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return {
    genesisHash: GENESIS,
    bucket: 1_800_000_000_000,
    nodeCount: 3,
    authorityCount: 2,
    staleCount: 0,
    bestHeight: 100,
    finalizedHeight: 97,
    finalityLag: 3,
    averageBlockTimeMs: 6000,
    versions: { "0.2.5": 2, "0.2.4": 1 },
    implementations: { "Orbinum Node": 3 },
    countries: { CL: 3 },
    ...overrides,
  };
}

describe("writeSnapshot", () => {
  it("upserts on (genesis, bucket) so a repeated alarm cannot double a point", () => {
    const { db, calls } = fakeDb();
    void writeSnapshot(db, snapshot());

    expect(calls[0].sql).toContain("ON CONFLICT(genesis, bucket) DO UPDATE");
  });

  it("serializes the histograms as JSON", async () => {
    const { db, calls } = fakeDb();
    await writeSnapshot(db, snapshot());

    const params = calls[0].params;
    expect(params[0]).toBe(GENESIS);
    expect(params[1]).toBe(1_800_000_000_000);
    expect(params[9]).toBe('{"0.2.5":2,"0.2.4":1}');
  });

  it("writes absent aggregates as NULL, never as 0", async () => {
    // A chain with no block yet has no height. Zero would plot as a real
    // height at the origin and read as a chain stuck at genesis.
    const { db, calls } = fakeDb();
    await writeSnapshot(
      db,
      snapshot({
        bestHeight: undefined,
        finalizedHeight: undefined,
        finalityLag: undefined,
        averageBlockTimeMs: undefined,
      }),
    );

    const params = calls[0].params;
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[8]).toBeNull();
  });
});

describe("readHistory", () => {
  it("maps snake_case columns to camelCase and parses the histogram", async () => {
    const { db } = fakeDb([
      {
        bucket: 1_800_000_000_000,
        node_count: 3,
        authority_count: 2,
        stale_count: 1,
        best_height: 100,
        finalized_height: 97,
        finality_lag: 3,
        avg_block_time_ms: 6000,
        versions: '{"0.2.5":3}',
      },
    ]);

    const [point] = await readHistory(db, GENESIS, 0);

    expect(point.nodeCount).toBe(3);
    expect(point.authorityCount).toBe(2);
    expect(point.finalityLag).toBe(3);
    expect(point.averageBlockTimeMs).toBe(6000);
    expect(point.versions).toEqual({ "0.2.5": 3 });
  });

  it("turns NULL columns into undefined rather than null", async () => {
    const { db } = fakeDb([
      {
        bucket: 1,
        node_count: 0,
        authority_count: 0,
        stale_count: 0,
        best_height: null,
        finalized_height: null,
        finality_lag: null,
        avg_block_time_ms: null,
        versions: "{}",
      },
    ]);

    const [point] = await readHistory(db, GENESIS, 0);

    expect(point.bestHeight).toBeUndefined();
    expect(point.finalizedHeight).toBeUndefined();
    expect(point.versions).toEqual({});
  });

  it("survives a malformed histogram instead of failing the whole read", async () => {
    const { db } = fakeDb([
      {
        bucket: 1,
        node_count: 1,
        authority_count: 0,
        stale_count: 0,
        best_height: null,
        finalized_height: null,
        finality_lag: null,
        avg_block_time_ms: null,
        versions: "not json",
      },
    ]);

    const [point] = await readHistory(db, GENESIS, 0);
    expect(point.versions).toEqual({});
    expect(point.nodeCount).toBe(1);
  });

  it("bounds the scan by the primary key, not by a filter on every row", async () => {
    const { db, calls } = fakeDb();
    await readHistory(db, GENESIS, 12345);

    expect(calls[0].sql).toContain("WHERE genesis = ?1 AND bucket >= ?2");
    expect(calls[0].params).toEqual([GENESIS, 12345]);
  });
});

describe("pruneHistory", () => {
  it("rolls up and deletes in one batch, so neither can happen alone", async () => {
    const { db, batches } = fakeDb();
    await pruneHistory(db, 1_800_000_000_000);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0].sql).toContain("INSERT INTO chain_history_hourly");
    expect(batches[0][1].sql).toContain("DELETE FROM chain_history");
  });

  it("uses the same cutoff for the rollup and the delete", async () => {
    // Two different cutoffs would either drop rows that were never rolled up,
    // or roll up rows that stay — both silently.
    const { db, batches } = fakeDb();
    const now = 1_800_000_000_000;
    await pruneHistory(db, now, 1000);

    expect(batches[0][0].params).toEqual([now - 1000]);
    expect(batches[0][1].params).toEqual([now - 1000]);
  });
});

describe("readHourlyHistory", () => {
  it("reads the raw buckets too, not only the rollup", async () => {
    // An hour only reaches chain_history_hourly once it falls out of the raw
    // table — 30 days later. A rollup-only query therefore answers "30d" with
    // nothing for any chain younger than the retention window, which reads as
    // "no history" rather than "not that much history yet".
    const { db, calls } = fakeDb();
    await readHourlyHistory(db, GENESIS, 1000);

    expect(calls[0].sql).toContain("chain_history_hourly");
    expect(calls[0].sql).toContain("FROM chain_history ");
  });

  it("folds raw rows into the same hour buckets the rollup uses", async () => {
    // Same expression as pruneHistory, so a point does not move the day its
    // hour is finally rolled up.
    const { db, calls } = fakeDb();
    await readHourlyHistory(db, GENESIS, 1000);

    expect(calls[0].sql).toContain("bucket / 3600000 * 3600000");
    expect(calls[0].sql).toContain("GROUP BY bucket / 3600000");
  });

  it("prefers the rollup where an hour exists in both tables", async () => {
    // Both can hold the same hour while a prune is in flight; counting it
    // twice would put two points on one timestamp.
    const { db, calls } = fakeDb();
    await readHourlyHistory(db, GENESIS, 1000);

    expect(calls[0].sql).toContain("NOT IN (SELECT bucket FROM rolled)");
  });

  it("bounds both halves by the same window", async () => {
    const { db, calls } = fakeDb();
    await readHourlyHistory(db, GENESIS, 12345);

    expect(calls[0].params).toEqual([GENESIS, 12345]);
  });

  it("returns points in bucket order", async () => {
    const { db, calls } = fakeDb();
    await readHourlyHistory(db, GENESIS, 0);

    expect(calls[0].sql.trimEnd().endsWith("ORDER BY bucket")).toBe(true);
  });
});
