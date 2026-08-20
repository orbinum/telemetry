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

function fakeDb(firstRow: unknown = null) {
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
