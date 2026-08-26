/**
 * Node session tests.
 *
 * The contract that matters here is when a row is written and what it claims:
 * a session opens once per connection even if the gateway replays a cached
 * system.connected, closes exactly once, and is closed in a single batch
 * however many nodes leave at the same time.
 */

import { describe, expect, it, vi } from "vitest";
import {
  closeOrphanSessions,
  closeSessions,
  openSession,
  readLastValidatorAddress,
  recordValidatorAddress,
} from "../../src/db/node-sessions";
import { NodeState } from "../../src/domain/node-state";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

interface Recorded {
  sql: string;
  params: unknown[];
}

function fakeDb(firstRow: unknown = null, changes = 0) {
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
        return Promise.resolve({ success: true, meta: { changes } });
      },
      first: () => {
        calls.push(record);
        return Promise.resolve(firstRow);
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

function node(name: string, opts: { authority?: boolean } = {}): NodeState {
  const msg: SystemConnectedMessage = {
    msg: "system.connected",
    id: 1,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: "Orbinum Node",
      version: "0.2.5",
      networkId: peerId(name),
      authority: opts.authority,
      sysinfo: { coreCount: 8, cpu: "test" },
    },
  };
  return new NodeState(msg, { country: "CL" }, 1000);
}

describe("openSession", () => {
  it("is keyed on the PeerId, not on the socket-derived node key", () => {
    // The socket key changes on every reconnect; the PeerId does not, which is
    // the whole reason per-node history is possible.
    const { db, calls } = fakeDb();
    const n = node("validator-1");
    void openSession(db, GENESIS, n);

    expect(calls[0].params[0]).toBe(peerId("validator-1"));
    expect(calls[0].params[1]).toBe(GENESIS);
    expect(calls[0].params[2]).toBe(1000);
  });

  it("ignores a replayed connect instead of opening a second session", async () => {
    // When a ChainDO is evicted the gateway replays its cached
    // system.connected. Without this the same connection would look like two.
    const { db, calls } = fakeDb();
    await openSession(db, GENESIS, node("validator-1"));

    expect(calls[0].sql).toContain("INSERT OR IGNORE");
  });

  it("records the authority flag and the sysinfo blob", async () => {
    const { db, calls } = fakeDb();
    await openSession(db, GENESIS, node("validator-1", { authority: true }));

    expect(calls[0].params[6]).toBe(1);
    expect(calls[0].params[7]).toBe("CL");
    expect(JSON.parse(calls[0].params[8] as string)).toEqual({ coreCount: 8, cpu: "test" });
  });

  it("writes a full node's authority flag as 0, never as NULL", async () => {
    const { db, calls } = fakeDb();
    await openSession(db, GENESIS, node("rpc-1"));

    expect(calls[0].params[6]).toBe(0);
  });
});

describe("closeSessions", () => {
  it("closes a whole sweep in one batch, not one call per node", async () => {
    // A reaper clearing a large chain issuing one statement per node is how a
    // single Worker invocation runs out of D1 queries.
    const { db, batches } = fakeDb();
    const departures = Array.from({ length: 50 }, (_, i) => ({
      networkId: peerId(i),
      connectedAt: 1000 + i,
    }));

    await closeSessions(db, GENESIS, departures, 9999);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(50);
  });

  it("only closes sessions still open, so the first close wins", async () => {
    // A node can be reaped and then have its socket close. The reaper saw it
    // leave first, and that is the honest timestamp.
    const { db, batches } = fakeDb();
    await closeSessions(db, GENESIS, [{ networkId: peerId("a"), connectedAt: 1000 }], 5000);

    expect(batches[0][0].sql).toContain("disconnected_at IS NULL");
  });

  it("does nothing at all when nobody left", async () => {
    const { db, batches, calls } = fakeDb();
    await closeSessions(db, GENESIS, [], 5000);

    expect(batches).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("validator address", () => {
  it("updates the open session rather than opening another", async () => {
    const { db, calls } = fakeDb();
    await recordValidatorAddress(db, GENESIS, peerId("validator-1"), 1000, "5FA9nQ");

    expect(calls[0].sql).toContain("UPDATE node_sessions SET validator");
    expect(calls[0].params).toEqual(["5FA9nQ", peerId("validator-1"), GENESIS, 1000]);
  });

  it("carries the address into a new session, so a reconnect keeps it", async () => {
    // Seeded from the previous session's address before afg has a chance to
    // arrive — and on a verbosity-0 network, it never will.
    const { db, calls } = fakeDb();
    const n = node("validator-1");
    n.setValidatorAddress("5FA9nQ");
    await openSession(db, GENESIS, n);

    expect(calls[0].params[9]).toBe("5FA9nQ");
  });

  it("writes NULL when the node never reported one", async () => {
    const { db, calls } = fakeDb();
    await openSession(db, GENESIS, node("rpc-1"));

    expect(calls[0].params[9]).toBeNull();
  });

  it("reads back the newest address, skipping sessions that had none", async () => {
    const { db, calls } = fakeDb({ validator: "5FA9nQ" });
    const address = await readLastValidatorAddress(db, GENESIS, peerId("validator-1"));

    expect(address).toBe("5FA9nQ");
    expect(calls[0].sql).toContain("validator IS NOT NULL");
    expect(calls[0].sql).toContain("ORDER BY connected_at DESC");
  });

  it("returns undefined when no session ever carried an address", async () => {
    const { db } = fakeDb(null);
    expect(await readLastValidatorAddress(db, GENESIS, peerId("rpc-1"))).toBeUndefined();
  });
});

describe("closeOrphanSessions", () => {
  it("closes each leftover at the moment its node next reconnected", async () => {
    const { db, calls } = fakeDb(null, 3);
    const closed = await closeOrphanSessions(db, GENESIS, [5000], 9000);

    expect(closed).toBe(3);
    const [call] = calls;
    // The fallback is only a COALESCE default: a leftover with a later session
    // is closed at that session's start, never at "now", or a node that left
    // days ago would be credited with the time in between.
    expect(call.sql).toContain("MIN(n.connected_at)");
    expect(call.sql).toContain("COALESCE");
    expect(call.params).toEqual([GENESIS, 9000]);
  });

  it("spares the sessions this object is holding", async () => {
    const { db, calls } = fakeDb(null, 0);
    await closeOrphanSessions(db, GENESIS, [5000, 6000], 9000);
    // Live rows are excluded by connected_at, which is part of the key.
    expect(calls[0].sql).toContain("NOT IN (5000,6000)");
  });

  it("closes everything open when the chain holds no live nodes", async () => {
    const { db, calls } = fakeDb(null, 7);
    const closed = await closeOrphanSessions(db, GENESIS, [], 9000);

    expect(closed).toBe(7);
    // No exclusion clause at all — an empty NOT IN () is a SQL syntax error.
    expect(calls[0].sql).not.toContain("NOT IN");
  });

  it("never touches a session opened after this object started", async () => {
    const { db, calls } = fakeDb(null, 0);
    await closeOrphanSessions(db, GENESIS, [], 9000);
    // Guards the race where a node connects while the sweep is in flight.
    expect(calls[0].sql).toContain("s.connected_at < ?2");
  });

  it("only ever closes sessions of its own chain", async () => {
    const { db, calls } = fakeDb(null, 0);
    await closeOrphanSessions(db, GENESIS, [], 9000);
    expect(calls[0].sql).toContain("s.genesis = ?1");
    expect(calls[0].sql).toContain("disconnected_at IS NULL");
  });
});

/**
 * The string assertions above pin the query's shape; this pins its effect.
 * An in-memory SQLite stands in for D1, which is SQLite underneath — the one
 * place the sweep can be checked against rows rather than SQL text.
 */
describe("closeOrphanSessions against real rows", () => {
  it("leaves exactly one open session per node, closed on real evidence", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      `CREATE TABLE node_sessions (
         network_id TEXT NOT NULL, genesis TEXT NOT NULL, connected_at INTEGER NOT NULL,
         disconnected_at INTEGER,
         PRIMARY KEY (network_id, genesis, connected_at)) WITHOUT ROWID`,
    );
    const insert = sqlite.prepare(
      "INSERT INTO node_sessions(network_id,genesis,connected_at,disconnected_at) VALUES (?,?,?,?)",
    );
    const OTHER = "0x" + "cd".repeat(32);
    insert.run("peer-1", GENESIS, 1000, null); // leftover, reconnected at 4000
    insert.run("peer-1", GENESIS, 4000, null); // leftover, no later session
    insert.run("peer-3", GENESIS, 5000, null); // live
    insert.run("peer-4", GENESIS, 3000, 3500); // already closed
    insert.run("peer-5", OTHER, 1000, null); // another chain
    insert.run("peer-6", GENESIS, 9500, null); // opened after this object started

    // Same statement the D1 helper builds, run against real SQL.
    const { db, calls } = fakeDb(null, 0);
    await closeOrphanSessions(db, GENESIS, [5000], 9000);
    sqlite.prepare(calls[0].sql.replace("?1", `'${GENESIS}'`).replace(/\?2/g, "9000")).run();

    const rows = sqlite
      .prepare(
        "SELECT network_id, connected_at, disconnected_at FROM node_sessions WHERE genesis = ?",
      )
      .all(GENESIS) as {
      network_id: string;
      connected_at: number;
      disconnected_at: number | null;
    }[];
    const at = (c: number) => rows.find((r) => r.connected_at === c)?.disconnected_at;

    // Closed at its node's next connect — never at the fallback, or a node that
    // left days ago would be credited with the gap.
    expect(at(1000)).toBe(4000);
    // No later session to prove otherwise, so the object's start time it is.
    expect(at(4000)).toBe(9000);
    expect(at(5000)).toBeNull(); // live
    expect(at(3000)).toBe(3500); // untouched
    expect(at(9500)).toBeNull(); // opened after the sweep's cutoff

    // Another chain's rows are never in scope.
    const other = sqlite
      .prepare("SELECT disconnected_at FROM node_sessions WHERE genesis = ?")
      .all(OTHER) as { disconnected_at: number | null }[];
    expect(other[0].disconnected_at).toBeNull();

    // The invariant the sweep exists for.
    const open = rows.filter((r) => r.disconnected_at === null);
    expect(open).toHaveLength(2); // the live node, plus the one opened after
    expect(new Set(open.map((r) => r.network_id)).size).toBe(open.length);
  });
});
