/**
 * The D1 repositories.
 *
 * They are thin — each method binds a database to a statement that is already
 * tested against real SQLite in `sql/`. What is *not* covered there is the
 * binding itself: `closeOrphans(genesis, liveConnectedAt, fallback)` takes two
 * arguments that are both plausible in either position, and transposing them
 * would leave every statement correct and every session closed at the wrong
 * moment.
 *
 * So these assert argument order and nothing else.
 */

import { describe, expect, it } from "vitest";
import { D1HistoryRepository } from "../../../src/platform/cloudflare/d1-history-repository";
import { D1SessionRepository } from "../../../src/platform/cloudflare/d1-session-repository";
import { sqliteD1 } from "../../support/sqlite-d1";
import { NodeState } from "../../../src/core/domain/node-state";
import { peerId } from "../../fixtures/peer-id";
import type { ChainSnapshot } from "../../../src/core/domain/chain-snapshot";
import type { SystemConnectedMessage } from "../../../src/core/protocol/node";

const GENESIS = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const MINUTE = 60_000;

function snapshot(bucket: number, nodeCount = 3): ChainSnapshot {
  return {
    genesisHash: GENESIS,
    bucket,
    nodeCount,
    authorityCount: 1,
    staleCount: 0,
    versions: {},
    implementations: {},
    countries: {},
  };
}

function node(name: string, connectedAt: number): NodeState {
  const msg: SystemConnectedMessage = {
    msg: "system.connected",
    id: 1,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(name),
    },
  };
  return new NodeState(msg, undefined, connectedAt);
}

describe("D1HistoryRepository", () => {
  it("round-trips a snapshot through the database it was given", async () => {
    const { db } = sqliteD1();
    const repo = new D1HistoryRepository(db);

    await repo.writeSnapshot(snapshot(MINUTE, 7));
    const [read] = await repo.readHistory(GENESIS, 0);

    expect(read.bucket).toBe(MINUTE);
    expect(read.nodeCount).toBe(7);
  });

  it("passes the window through rather than reading everything", async () => {
    const { db } = sqliteD1();
    const repo = new D1HistoryRepository(db);
    await repo.writeSnapshot(snapshot(MINUTE));
    await repo.writeSnapshot(snapshot(5 * MINUTE));

    expect(await repo.readHistory(GENESIS, 3 * MINUTE)).toHaveLength(1);
  });

  it("honours the retention argument, not just the default", async () => {
    const { db, raw } = sqliteD1();
    const repo = new D1HistoryRepository(db);
    await repo.writeSnapshot(snapshot(MINUTE));

    // A short retention passed explicitly must prune what the 30-day default
    // would have kept.
    await repo.prune(MINUTE * 10, MINUTE);
    const rows = raw.prepare("SELECT COUNT(*) c FROM chain_history").get() as { c: number };
    expect(rows.c).toBe(0);
  });
});

describe("D1SessionRepository", () => {
  it("opens and reads back a session for the chain it was told", async () => {
    const { db } = sqliteD1();
    const repo = new D1SessionRepository(db);
    const alpha = node("alpha", 1000);

    await repo.open(GENESIS, alpha);
    const rows = await repo.readSessions(GENESIS, alpha.details.networkId, 0);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("alpha");
    // The genesis argument is not decorative: another chain sees nothing.
    expect(await repo.readSessions(OTHER, alpha.details.networkId, 0)).toEqual([]);
  });

  it("closes the session it names, at the time it is given", async () => {
    const { db, raw } = sqliteD1();
    const repo = new D1SessionRepository(db);
    const alpha = node("alpha", 1000);
    await repo.open(GENESIS, alpha);

    await repo.close(GENESIS, [{ networkId: alpha.details.networkId, connectedAt: 1000 }], 5000);

    const [row] = raw.prepare("SELECT disconnected_at d FROM node_sessions").all() as {
      d: number;
    }[];
    expect(row.d).toBe(5000);
  });

  it("keeps liveConnectedAt and fallback in their own positions", async () => {
    const { db, raw } = sqliteD1();
    const repo = new D1SessionRepository(db);
    await repo.open(GENESIS, node("gone", 1000));
    await repo.open(GENESIS, node("live", 5000));

    // Transposing these two arguments type-checks — both are numeric — and
    // would spare the wrong session while closing the live one.
    const closed = await repo.closeOrphans(GENESIS, [5000], 9000);

    expect(closed).toBe(1);
    const rows = raw
      .prepare("SELECT connected_at c, disconnected_at d FROM node_sessions ORDER BY connected_at")
      .all() as { c: number; d: number | null }[];
    expect(rows.find((r) => r.c === 1000)?.d).toBe(9000);
    expect(rows.find((r) => r.c === 5000)?.d).toBeNull();
  });

  it("records a validator address against the session it identifies", async () => {
    const { db } = sqliteD1();
    const repo = new D1SessionRepository(db);
    const val = node("validator", 1000);
    await repo.open(GENESIS, val);

    await repo.recordValidatorAddress(GENESIS, val.details.networkId, 1000, "addr-1");

    expect(await repo.readLastValidatorAddress(GENESIS, val.details.networkId)).toBe("addr-1");
  });

  it("computes uptime over the window it is handed", async () => {
    const { db } = sqliteD1();
    const repo = new D1SessionRepository(db);
    await repo.open(GENESIS, node("long", 0));

    // Open since epoch, asked about one hour: the answer is the hour.
    const [row] = await repo.readUptime(GENESIS, 10 * 3_600_000, 11 * 3_600_000);
    expect(row.uptimeMs).toBe(3_600_000);
  });
});
