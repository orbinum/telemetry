/**
 * The session SQL, executed rather than recorded.
 *
 * `readUptime` is the reason this file exists: it clamps sessions to a window
 * with nested MIN/MAX/COALESCE over a GROUP BY, and it is the query that was
 * silently inflating uptime in production when orphaned rows made
 * `COALESCE(disconnected_at, now)` read a long-dead session as still running.
 * A recording double cannot catch arithmetic.
 */

import { describe, expect, it } from "vitest";
import {
  closeOrphanSessions,
  closeSessions,
  openSession,
  pruneSessions,
  readLastValidatorAddress,
  readSessions,
  readUptime,
  recordValidatorAddress,
} from "../../src/db/node-sessions";
import { NodeState } from "../../src/domain/node-state";
import { sqliteD1 } from "../support/sqlite-d1";
import { peerId } from "../fixtures/peer-id";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const GENESIS = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const HOUR = 3_600_000;

function node(name: string, connectedAt: number, opts: { authority?: boolean } = {}): NodeState {
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
      authority: opts.authority,
    },
  };
  return new NodeState(msg, { country: "CL" }, connectedAt);
}

describe("openSession", () => {
  it("writes a row a replayed connect cannot duplicate", async () => {
    const { db, raw } = sqliteD1();
    const n = node("alpha", 1000);
    await openSession(db, GENESIS, n);
    // The gateway replays a cached system.connected after an eviction; the
    // primary key is what makes that a no-op rather than a second session.
    await openSession(db, GENESIS, n);

    const rows = raw.prepare("SELECT * FROM node_sessions").all() as { name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("alpha");
  });
});

describe("validator address", () => {
  it("records and reads back the most recent one", async () => {
    const { db } = sqliteD1();
    const first = node("v", 1000);
    await openSession(db, GENESIS, first);
    await recordValidatorAddress(db, GENESIS, first.details.networkId, 1000, "addr-1");

    const later = node("v", 2000);
    await openSession(db, GENESIS, later);
    await recordValidatorAddress(db, GENESIS, later.details.networkId, 2000, "addr-2");

    expect(await readLastValidatorAddress(db, GENESIS, first.details.networkId)).toBe("addr-2");
  });

  it("returns undefined when the node never announced one", async () => {
    const { db } = sqliteD1();
    const n = node("quiet", 1000);
    await openSession(db, GENESIS, n);
    expect(await readLastValidatorAddress(db, GENESIS, n.details.networkId)).toBeUndefined();
  });
});

describe("closeSessions", () => {
  it("closes only the open session it names", async () => {
    const { db, raw } = sqliteD1();
    const n = node("alpha", 1000);
    await openSession(db, GENESIS, n);
    await closeSessions(db, GENESIS, [{ networkId: n.details.networkId, connectedAt: 1000 }], 5000);
    // A node closed by the reaper and then by its socket keeps the earlier,
    // truthful timestamp.
    await closeSessions(db, GENESIS, [{ networkId: n.details.networkId, connectedAt: 1000 }], 9000);

    const [row] = raw.prepare("SELECT disconnected_at d FROM node_sessions").all() as {
      d: number;
    }[];
    expect(row.d).toBe(5000);
  });
});

describe("closeOrphanSessions", () => {
  it("closes leftovers on real evidence and spares the live ones", async () => {
    const { db, raw } = sqliteD1();
    const a = node("a", 1000);
    const later = node("a", 4000); // same node, reconnected
    const live = node("b", 5000);
    for (const n of [a, later, live]) await openSession(db, GENESIS, n);

    const closed = await closeOrphanSessions(db, GENESIS, [5000], 9000);
    expect(closed).toBe(2);

    const rows = raw
      .prepare("SELECT connected_at c, disconnected_at d FROM node_sessions ORDER BY connected_at")
      .all() as { c: number; d: number | null }[];
    // Closed at the moment its node next reconnected, never at the fallback.
    expect(rows.find((r) => r.c === 1000)?.d).toBe(4000);
    // No later session to prove otherwise, so the sweeper's start time it is.
    expect(rows.find((r) => r.c === 4000)?.d).toBe(9000);
    expect(rows.find((r) => r.c === 5000)?.d).toBeNull();
  });

  it("never reaches into another chain", async () => {
    const { db, raw } = sqliteD1();
    await openSession(db, OTHER, node("elsewhere", 1000));
    await closeOrphanSessions(db, GENESIS, [], 9000);

    const [row] = raw.prepare("SELECT disconnected_at d FROM node_sessions").all() as {
      d: number | null;
    }[];
    expect(row.d).toBeNull();
  });
});

describe("readUptime", () => {
  it("clamps a session that outruns the window", async () => {
    const { db } = sqliteD1();
    const n = node("long", 0);
    await openSession(db, GENESIS, n);

    // Open since epoch, asked about the last hour: the answer is one hour, not
    // the age of the session.
    const [row] = await readUptime(db, GENESIS, 10 * HOUR, 11 * HOUR);
    expect(row.uptimeMs).toBe(HOUR);
  });

  it("sums several sessions and counts them", async () => {
    const { db } = sqliteD1();
    const id = peerId("flappy");
    for (const [at, until] of [
      [HOUR, 2 * HOUR],
      [3 * HOUR, 4 * HOUR],
    ]) {
      await openSession(db, GENESIS, node("flappy", at));
      await closeSessions(db, GENESIS, [{ networkId: id, connectedAt: at }], until);
    }

    const [row] = await readUptime(db, GENESIS, 0, 5 * HOUR);
    expect(row.uptimeMs).toBe(2 * HOUR);
    // A high count is how a flapping node gives itself away.
    expect(row.sessions).toBe(2);
  });

  it("excludes a node whose sessions all ended before the window", async () => {
    const { db } = sqliteD1();
    const n = node("gone", 0);
    await openSession(db, GENESIS, n);
    await closeSessions(db, GENESIS, [{ networkId: n.details.networkId, connectedAt: 0 }], HOUR);

    expect(await readUptime(db, GENESIS, 5 * HOUR, 6 * HOUR)).toEqual([]);
  });

  it("reports authority from any session of that node", async () => {
    const { db } = sqliteD1();
    await openSession(db, GENESIS, node("val", HOUR, { authority: true }));
    const [row] = await readUptime(db, GENESIS, 0, 2 * HOUR);
    expect(row.isAuthority).toBe(true);
  });
});

describe("readSessions", () => {
  it("returns one node's sessions, newest first", async () => {
    const { db } = sqliteD1();
    const id = peerId("multi");
    for (const at of [HOUR, 2 * HOUR]) await openSession(db, GENESIS, node("multi", at));

    const rows = await readSessions(db, GENESIS, id, 0);
    expect(rows.map((r) => r.connectedAt)).toEqual([2 * HOUR, HOUR]);
  });
});

describe("pruneSessions", () => {
  it("drops rows past the retention window", async () => {
    const { db, raw } = sqliteD1();
    await openSession(db, GENESIS, node("old", HOUR));
    await openSession(db, GENESIS, node("recent", 10 * HOUR));

    await pruneSessions(db, 10 * HOUR + 1, 5 * HOUR);

    const rows = raw.prepare("SELECT name FROM node_sessions").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["recent"]);
  });

  it("drops a one-off short session but keeps a node that came back", async () => {
    const { db, raw } = sqliteD1();
    // A node with no persistent volume: new identity, one brief session.
    const throwaway = node("throwaway", HOUR);
    await openSession(db, GENESIS, throwaway);
    await closeSessions(
      db,
      GENESIS,
      [{ networkId: throwaway.details.networkId, connectedAt: HOUR }],
      HOUR + 1000,
    );

    // A node with two short sessions is a history, however brief each one was.
    const regular = peerId("regular");
    for (const at of [HOUR, 2 * HOUR]) {
      await openSession(db, GENESIS, node("regular", at));
      await closeSessions(db, GENESIS, [{ networkId: regular, connectedAt: at }], at + 1000);
    }

    await pruneSessions(db, 3 * HOUR, 100 * HOUR);

    const names = (
      raw.prepare("SELECT DISTINCT name FROM node_sessions").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(["regular"]);
  });
});
