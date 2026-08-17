import { describe, expect, it } from "vitest";
import { ChainState, STALE_TIMEOUT_MS } from "../../src/domain/chain-state";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

function hashAt(height: number): string {
  return "0x" + height.toString(16).padStart(64, "0");
}

function connected(id: number, name: string): SystemConnectedMessage {
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

function chainWith(...keys: string[]): ChainState {
  const chain = new ChainState(GENESIS);
  keys.forEach((key, i) => chain.addNode(key, connected(i + 1, key), undefined, 1000));
  return chain;
}

function importBlock(chain: ChainState, key: string, height: number, now: number): void {
  chain.applyMessage(
    key,
    { msg: "block.import", id: 0, block: { hash: hashAt(height), height } },
    now,
  );
}

function nodeOf(chain: ChainState, key: string) {
  const entry = chain.list().find((e) => e.key === key);
  if (entry === undefined) throw new Error(`node ${key} missing`);
  return entry.node;
}

describe("propagation", () => {
  it("first reporter gets 0, later reporters get the delay", () => {
    const chain = chainWith("a", "b", "c");

    importBlock(chain, "a", 10, 5000);
    importBlock(chain, "b", 10, 5300);
    importBlock(chain, "c", 10, 5450);

    expect(nodeOf(chain, "a").best?.propagationTime).toBe(0);
    expect(nodeOf(chain, "b").best?.propagationTime).toBe(300);
    expect(nodeOf(chain, "c").best?.propagationTime).toBe(450);
  });

  it("propagation resets per height", () => {
    const chain = chainWith("a", "b");
    importBlock(chain, "a", 10, 5000);
    importBlock(chain, "b", 11, 9000); // b jumps ahead → first at 11
    expect(nodeOf(chain, "b").best?.propagationTime).toBe(0);
    importBlock(chain, "a", 11, 9200);
    expect(nodeOf(chain, "a").best?.propagationTime).toBe(200);
  });

  it("a node reporting an old height gets no propagation update", () => {
    const chain = chainWith("a", "b");
    importBlock(chain, "a", 10, 5000);
    importBlock(chain, "a", 11, 11000);
    importBlock(chain, "b", 10, 11500); // behind the chain best
    expect(nodeOf(chain, "b").best?.propagationTime).toBeUndefined();
  });
});

describe("chain aggregates", () => {
  it("tracks best and average block time", () => {
    const chain = chainWith("a");
    importBlock(chain, "a", 1, 1000);
    importBlock(chain, "a", 2, 7000);
    importBlock(chain, "a", 3, 13_000);
    expect(chain.best?.height).toBe(3);
    expect(chain.averageBlockTime).toBe(6000);
  });

  it("tracks the highest finalized across nodes, from both wire shapes", () => {
    const chain = chainWith("a", "b");
    // notify.finalized (height arrives as string on the wire, number here)
    chain.applyMessage(
      "a",
      { msg: "notify.finalized", id: 0, block: { hash: hashAt(90), height: 90 } },
      2000,
    );
    // system.interval carrying the finalized pair
    chain.applyMessage(
      "b",
      { msg: "system.interval", id: 0, finalizedHash: hashAt(95), finalizedHeight: 95 },
      3000,
    );
    expect(chain.finalized?.height).toBe(95);
    expect(nodeOf(chain, "a").finalized?.height).toBe(90);
  });

  it("applies afg and hwbench to the right node", () => {
    const chain = chainWith("a", "b");
    chain.applyMessage("a", { msg: "afg.authority_set", id: 0, authorityId: "5Auth" }, 2000);
    chain.applyMessage(
      "b",
      { msg: "sysinfo.hwbench", id: 0, cpuHashrateScore: 1, memoryMemcpyScore: 2 },
      2000,
    );
    expect(nodeOf(chain, "a").validator).toBe("5Auth");
    expect(nodeOf(chain, "b").hwbench?.cpuHashrateScore).toBe(1);
    expect(nodeOf(chain, "b").validator).toBeUndefined();
  });

  it("drops messages that arrive before system.connected", () => {
    const chain = chainWith("a");
    importBlock(chain, "ghost", 10, 2000);
    expect(chain.best).toBeUndefined();
  });
});

describe("stale sweep", () => {
  it("marks quiet nodes stale and recomputes best from live ones", () => {
    const chain = chainWith("live", "quiet");
    importBlock(chain, "quiet", 10, 1000);
    importBlock(chain, "live", 10, 1100);

    // Beyond the stale window, only "live" keeps importing.
    const later = 1000 + STALE_TIMEOUT_MS + 1000;
    importBlock(chain, "live", 11, later);

    expect(nodeOf(chain, "quiet").stale).toBe(true);
    expect(nodeOf(chain, "live").stale).toBe(false);
    expect(chain.best?.height).toBe(11);
  });
});

describe("lifecycle", () => {
  it("removes only the closing connection's nodes by prefix", () => {
    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", connected(1, "conn1"), undefined, 1000);
    chain.addNode("11:1", connected(1, "conn11"), undefined, 1000);

    expect(chain.removeConnection("1:")).toEqual([id]);

    expect(chain.hasNode("1:1")).toBe(false);
    expect(chain.hasNode("11:1")).toBe(true); // "11:" must not match "1:"
  });

  it("assigns stable feed ids, reusing them when a node re-announces", () => {
    const chain = new ChainState(GENESIS);
    const first = chain.addNode("1:1", connected(1, "a"), undefined, 1000);
    const second = chain.addNode("1:2", connected(2, "b"), undefined, 1000);
    expect(second).not.toBe(first);
    // Same key re-announcing (gateway replay after eviction) keeps its id.
    expect(chain.addNode("1:1", connected(1, "a"), undefined, 2000)).toBe(first);
  });

  it("reaps nodes that stopped reporting and reports their feed ids", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a"), undefined, 1000);
    const bId = chain.addNode("b", connected(2, "b"), undefined, 1000);
    chain.applyMessage("a", { msg: "system.interval", id: 1 }, 70_000);

    expect(chain.reapExpired(70_000, 60_000)).toEqual([bId]); // b (lastSeen 1000)
    expect(chain.hasNode("a")).toBe(true);
    expect(chain.hasNode("b")).toBe(false);
  });

  it("attaches geo to the nodes it announces", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", connected(1, "a"), { city: "Santiago", country: "CL" }, 1000);
    expect(nodeOf(chain, "1:1").geo?.city).toBe("Santiago");
  });
});
