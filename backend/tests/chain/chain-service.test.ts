/**
 * The chain's orchestration, which until now could not be constructed outside
 * a Durable Object and so was pinned by comments rather than tests.
 *
 * What is worth pinning here is *order*. `alarm()` reaps, then sweeps, then
 * records, and each step has a comment explaining why it sits where it does —
 * reversing any two of them produces plausible output and wrong history.
 */

import { describe, expect, it, vi } from "vitest";
import { ChainService, REAPER_INTERVAL_MS } from "../../src/chain/chain-service";
import { NODE_TIMEOUT_MS } from "../../src/domain/chain-state";
import { peerId } from "../fixtures/peer-id";
import type { ChainServiceDeps } from "../../src/chain/chain-service";
import type { ChainSnapshot } from "../../src/domain/chain-snapshot";
import type {
  HistoryRepository,
  SessionDeparture,
  SessionRepository,
} from "../../src/ports/persistence";
import type { OutboundSocket } from "../../src/ports/transport";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const GENESIS = "0x" + "ab".repeat(32);

function connected(id: number, name = `node-${id}`): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(name),
    },
  };
}

/**
 * A service wired to recording doubles, with time under the test's control.
 *
 * `calls` records every write in the order it was started, which is the only
 * way to assert on a sequence whose steps are all fire-and-forget.
 */
function setup(opts: { storage?: boolean } = {}) {
  const calls: string[] = [];
  let now = 1_000_000;
  const sent: string[] = [];
  const socket: OutboundSocket = { send: (f) => sent.push(f), close: () => {} };

  const armed: number[] = [];
  let pending: number | null = null;

  const history = {
    writeSnapshot: vi.fn<HistoryRepository["writeSnapshot"]>(async (s: ChainSnapshot) => {
      calls.push(`history:${s.nodeCount}`);
    }),
    readHistory: vi.fn(async () => []),
    readHourlyHistory: vi.fn(async () => []),
    prune: vi.fn(async () => {}),
  } as unknown as HistoryRepository;

  let lastAddress: string | undefined;
  const sessions = {
    open: vi.fn(async () => {
      calls.push("session:open");
    }),
    close: vi.fn<SessionRepository["close"]>(async (_g, departures: SessionDeparture[]) => {
      calls.push(`session:close:${departures.length}`);
    }),
    closeOrphans: vi.fn(async () => {
      calls.push("session:sweep");
      return 0;
    }),
    recordValidatorAddress: vi.fn(async () => {
      calls.push("validator:write");
    }),
    readLastValidatorAddress: vi.fn(async () => lastAddress),
    readUptime: vi.fn(async () => []),
    readSessions: vi.fn(async () => []),
    prune: vi.fn(async () => {}),
  } as unknown as SessionRepository;

  // Deferred work runs eagerly here; production holds the invocation open for
  // it, and either way the caller does not wait.
  const pendingWork: Promise<unknown>[] = [];
  const deps: ChainServiceDeps = {
    clock: () => now,
    deferred: { run: (work) => void pendingWork.push(work.catch(() => {})) },
    alarms: {
      pending: async () => pending,
      arm: async (at) => {
        armed.push(at);
        pending = at;
      },
    },
    sockets: () => [socket],
    history: opts.storage === false ? undefined : history,
    sessions: opts.storage === false ? undefined : sessions,
  };

  return {
    service: new ChainService(deps),
    calls,
    armed,
    sent,
    socket,
    history,
    sessions,
    settle: () => Promise.all(pendingWork),
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
    setStoredAddress: (address: string | undefined) => {
      lastAddress = address;
    },
  };
}

describe("alarm ordering", () => {
  it("closes the reaped sessions before writing the history row", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.service.nodeConnected("c:2", connected(2), undefined);
    await t.settle();
    t.calls.length = 0;

    // Node 1 keeps reporting; node 2 goes silent past the timeout.
    t.advance(NODE_TIMEOUT_MS + 1);
    await t.service.nodeMessages([{ nodeKey: "c:1", msg: { msg: "system.interval", id: 1 } }]);
    await t.service.alarm();
    await t.settle();

    // The row must describe the nodes still here, so the close comes first.
    expect(t.calls).toEqual(["session:close:1", "history:1"]);
  });

  it("counts only the survivors in the history row", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.service.nodeConnected("c:2", connected(2), undefined);
    await t.settle();

    t.advance(NODE_TIMEOUT_MS + 1);
    await t.service.nodeMessages([{ nodeKey: "c:1", msg: { msg: "system.interval", id: 1 } }]);
    await t.service.alarm();
    await t.settle();

    const snapshot = vi.mocked(t.history.writeSnapshot).mock.calls.at(-1)?.[0];
    expect(snapshot?.nodeCount).toBe(1);
  });

  it("keeps sweeping while the chain has nodes", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.settle();
    const armedOnConnect = t.armed.length;

    await t.service.alarm();
    expect(t.armed).toHaveLength(armedOnConnect + 1);
    expect(t.armed.at(-1)).toBe(t.at() + REAPER_INTERVAL_MS);
  });

  it("stops once the last node is reaped, so a dead chain goes idle", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.settle();
    t.armed.length = 0;

    t.advance(NODE_TIMEOUT_MS + 1);
    await t.service.alarm();

    expect(t.armed).toEqual([]);
  });

  it("does nothing at all before the chain exists", async () => {
    const t = setup();
    await t.service.alarm();
    await t.settle();
    expect(t.calls).toEqual([]);
    expect(t.armed).toEqual([]);
  });
});

describe("arming the reaper", () => {
  it("arms once however many nodes connect at the same moment", async () => {
    const t = setup();
    for (let id = 1; id <= 5; id++) {
      await t.service.nodeConnected(`c:${id}`, connected(id), undefined);
    }
    await t.settle();

    // Reading the pending alarm before setting one is what stops a chain
    // gaining a hundred nodes from stacking a hundred alarms.
    expect(t.armed).toHaveLength(1);
  });
});

describe("the orphan sweep", () => {
  it("runs once per instance, on the first connect", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.service.nodeConnected("c:2", connected(2), undefined);
    await t.settle();

    expect(t.calls.filter((c) => c === "session:sweep")).toHaveLength(1);
  });

  it("spares the sessions this instance is holding", async () => {
    const t = setup();
    const connectedAt = t.at();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.settle();

    expect(vi.mocked(t.sessions.closeOrphans)).toHaveBeenCalledWith(
      GENESIS,
      [connectedAt],
      connectedAt,
    );
  });
});

describe("restoring a validator address", () => {
  /** What a browser connecting right now would be told about node 1. */
  function addressInSnapshot(t: ReturnType<typeof setup>): string | undefined {
    t.sent.length = 0;
    t.service.greet(t.socket);
    const init = t.sent.map(
      (f) => JSON.parse(f) as { t: string; nodes?: { validator?: string }[] },
    );
    return init.find((f) => f.t === "init")?.nodes?.[0]?.validator;
  }

  it("fills a gap from storage", async () => {
    const t = setup();
    t.setStoredAddress("addr-stored");
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.settle();

    // Verbosity 0 never sends afg.authority_set, so without the lookup the
    // Address column is empty for every validator, forever.
    expect(addressInSnapshot(t)).toBe("addr-stored");
  });

  it("never overwrites an address that arrived while storage was read", async () => {
    const t = setup();
    t.setStoredAddress("addr-stale");
    await t.service.nodeConnected("c:1", connected(1), undefined);

    // The live message lands before the read resolves — the race the re-check
    // inside the deferred callback exists for.
    await t.service.nodeMessages([
      { nodeKey: "c:1", msg: { msg: "afg.authority_set", id: 1, authorityId: "addr-live" } },
    ]);
    await t.settle();

    expect(addressInSnapshot(t)).toBe("addr-live");
  });
});

describe("without storage configured", () => {
  it("serves the feed and never reaches for a repository", async () => {
    const t = setup({ storage: false });
    await t.service.nodeConnected("c:1", connected(1), undefined);
    await t.service.alarm();
    await t.settle();

    // The binding is optional: history simply stops being recorded.
    expect(t.calls).toEqual([]);
  });
});

describe("eviction recovery", () => {
  it("reports the node keys it does not know so the caller can replay them", async () => {
    const t = setup();
    const unknown = await t.service.nodeMessages([
      { nodeKey: "c:9", msg: { msg: "system.interval", id: 9 } },
    ]);
    expect(unknown).toEqual(["c:9"]);
  });

  it("accepts a batch once its node has been introduced", async () => {
    const t = setup();
    await t.service.nodeConnected("c:1", connected(1), undefined);
    const unknown = await t.service.nodeMessages([
      { nodeKey: "c:1", msg: { msg: "system.interval", id: 1 } },
    ]);
    expect(unknown).toEqual([]);
  });
});
