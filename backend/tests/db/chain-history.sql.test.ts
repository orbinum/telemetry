/**
 * The history SQL, executed rather than recorded.
 *
 * The sibling `chain-history.test.ts` asserts the shape of the statements this
 * module builds; it never hands them to a parser. These run the same
 * statements against real SQLite and the real migrations, which is the only
 * way a typo in the thirty-line CTE in `readHourlyHistory` fails a test rather
 * than a deploy.
 */

import { describe, expect, it } from "vitest";
import {
  RAW_RETENTION_MS,
  pruneHistory,
  readHistory,
  readHourlyHistory,
  writeSnapshot,
} from "../../src/db/chain-history";
import { sqliteD1 } from "../support/sqlite-d1";
import type { ChainSnapshot } from "../../src/domain/chain-snapshot";

const GENESIS = "0x" + "ab".repeat(32);
const MINUTE = 60_000;

function snapshot(bucket: number, over: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return {
    genesisHash: GENESIS,
    bucket,
    nodeCount: 3,
    authorityCount: 1,
    staleCount: 0,
    bestHeight: 100,
    finalizedHeight: 98,
    finalityLag: 2,
    averageBlockTimeMs: 6000,
    versions: { "1.0.0": 3 },
    implementations: { orbinum: 3 },
    countries: { CL: 3 },
    ...over,
  };
}

describe("writeSnapshot", () => {
  it("round-trips a snapshot through real SQL", async () => {
    const { db } = sqliteD1();
    await writeSnapshot(db, snapshot(MINUTE));

    const [point] = await readHistory(db, GENESIS, 0);
    expect(point).toMatchObject({
      bucket: MINUTE,
      nodeCount: 3,
      authorityCount: 1,
      bestHeight: 100,
      finalizedHeight: 98,
      finalityLag: 2,
      averageBlockTimeMs: 6000,
      versions: { "1.0.0": 3 },
    });
  });

  it("overwrites its own bucket instead of doubling the series", async () => {
    const { db } = sqliteD1();
    // The idempotency the bucket key exists for: an alarm that fires twice in
    // the same minute must leave one row, not two.
    await writeSnapshot(db, snapshot(MINUTE, { nodeCount: 3 }));
    await writeSnapshot(db, snapshot(MINUTE, { nodeCount: 7 }));

    const points = await readHistory(db, GENESIS, 0);
    expect(points).toHaveLength(1);
    expect(points[0].nodeCount).toBe(7);
  });

  it("keeps chains apart", async () => {
    const { db } = sqliteD1();
    const other = "0x" + "cd".repeat(32);
    await writeSnapshot(db, snapshot(MINUTE));
    await writeSnapshot(db, snapshot(MINUTE, { genesisHash: other, nodeCount: 99 }));

    expect(await readHistory(db, GENESIS, 0)).toHaveLength(1);
    expect((await readHistory(db, other, 0))[0].nodeCount).toBe(99);
  });

  it("stores an absent height as null rather than zero", async () => {
    const { db } = sqliteD1();
    await writeSnapshot(
      db,
      snapshot(MINUTE, {
        bestHeight: undefined,
        finalizedHeight: undefined,
        finalityLag: undefined,
        averageBlockTimeMs: undefined,
      }),
    );

    const [point] = await readHistory(db, GENESIS, 0);
    expect(point.bestHeight).toBeUndefined();
    expect(point.averageBlockTimeMs).toBeUndefined();
  });
});

describe("readHistory", () => {
  it("returns points from the window, in order", async () => {
    const { db } = sqliteD1();
    for (const n of [3, 1, 2]) await writeSnapshot(db, snapshot(n * MINUTE));

    const points = await readHistory(db, GENESIS, 2 * MINUTE);
    expect(points.map((p) => p.bucket)).toEqual([2 * MINUTE, 3 * MINUTE]);
  });
});

describe("pruneHistory", () => {
  it("rolls minute buckets into hours and drops the raw rows", async () => {
    const { db, raw } = sqliteD1();
    const old = 1_000 * 3_600_000; // an hour boundary, far in the past
    await writeSnapshot(db, snapshot(old, { nodeCount: 2 }));
    await writeSnapshot(db, snapshot(old + MINUTE, { nodeCount: 4 }));

    await pruneHistory(db, old + MINUTE + RAW_RETENTION_MS + 1);

    const rawRows = raw.prepare("SELECT COUNT(*) c FROM chain_history").get() as { c: number };
    const hourly = raw.prepare("SELECT bucket, node_count_max FROM chain_history_hourly").all() as {
      bucket: number;
      node_count_max: number;
    }[];

    expect(rawRows.c).toBe(0);
    expect(hourly).toHaveLength(1);
    expect(hourly[0].bucket).toBe(old);
    expect(hourly[0].node_count_max).toBe(4);
  });

  it("leaves buckets inside the retention window alone", async () => {
    const { db } = sqliteD1();
    const now = 1_000 * 3_600_000;
    await writeSnapshot(db, snapshot(now));

    await pruneHistory(db, now + MINUTE);
    expect(await readHistory(db, GENESIS, 0)).toHaveLength(1);
  });

  it("is a transaction: the rollup never commits without its prune", async () => {
    const { db, raw } = sqliteD1();
    const old = 1_000 * 3_600_000;
    await writeSnapshot(db, snapshot(old));

    // Break the delete half, then assert the insert half did not survive.
    raw.exec(
      "CREATE TRIGGER stop_delete BEFORE DELETE ON chain_history " +
        "BEGIN SELECT RAISE(ABORT, 'no'); END",
    );
    await expect(pruneHistory(db, old + RAW_RETENTION_MS + 1)).rejects.toThrow();

    const hourly = raw.prepare("SELECT COUNT(*) c FROM chain_history_hourly").get() as {
      c: number;
    };
    expect(hourly.c).toBe(0);
  });
});

describe("readHourlyHistory", () => {
  it("aggregates raw buckets exactly as pruneHistory would", async () => {
    // The two share this by contract, stated in a comment rather than enforced
    // anywhere — so a chain younger than the retention window must read the
    // same as one that has already been rolled up.
    const hour = 1_000 * 3_600_000;
    const rolled = sqliteD1();
    const live = sqliteD1();
    const points = [
      snapshot(hour, { nodeCount: 2, bestHeight: 10 }),
      snapshot(hour + MINUTE, { nodeCount: 6, bestHeight: 20 }),
    ];
    for (const point of points) {
      await writeSnapshot(rolled.db, point);
      await writeSnapshot(live.db, point);
    }

    // One side gets rolled up and pruned; the other stays raw.
    await pruneHistory(rolled.db, hour + MINUTE + RAW_RETENTION_MS + 1);

    const fromRollup = await readHourlyHistory(rolled.db, GENESIS, 0);
    const fromRaw = await readHourlyHistory(live.db, GENESIS, 0);
    expect(fromRollup).toEqual(fromRaw);
  });

  it("does not double-count an hour present in both tables", async () => {
    const { db } = sqliteD1();
    const hour = 1_000 * 3_600_000;
    await writeSnapshot(db, snapshot(hour));
    await pruneHistory(db, hour + RAW_RETENTION_MS + 1);
    // A fresh minute lands in the same hour the rollup already owns.
    await writeSnapshot(db, snapshot(hour + MINUTE, { nodeCount: 9 }));

    const points = await readHourlyHistory(db, GENESIS, 0);
    expect(points.filter((p) => p.bucket === hour)).toHaveLength(1);
  });
});
