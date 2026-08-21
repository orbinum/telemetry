import { describe, expect, it } from "vitest";
import { ChainState } from "../../src/domain/chain-state";
import { toFeedChain, toFeedNode, toFeedNodeSeries } from "../../src/feed/serialize";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);
const HASH = "0x" + "cd".repeat(32);

function connected(
  overrides: Partial<SystemConnectedMessage["node"]> = {},
): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id: 1,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name: "validator-1",
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId("test"),
      ...overrides,
    },
  };
}

describe("toFeedNode", () => {
  it("flattens block details into the wire row", () => {
    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", connected(), { city: "Santiago" }, 1000);
    chain.applyMessage(
      "1:1",
      { msg: "block.import", id: 1, block: { hash: HASH, height: 7 } },
      5000,
    );

    const node = chain.getById(id);
    if (node === undefined) throw new Error("node missing");
    const row = toFeedNode(id, node);

    expect(row).toMatchObject({
      id,
      name: "validator-1",
      best: { hash: HASH, height: 7 },
      propagationTime: 0,
      lastBlockAt: 5000,
      stale: false,
      geo: { city: "Santiago" },
    });
  });

  it("carries the PeerId, the one id that survives a restart", () => {
    // The row's `id` is a counter that resets with the Durable Object, so it
    // cannot identify a node across sessions. The PeerId can, which is why the
    // UI needs it on the wire.
    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", connected(), undefined, 1000);

    expect(toFeedNode(id, chain.getById(id)!).networkId).toBe(peerId("test"));
  });

  it("parses startupTime from the node's quoted string, dropping garbage", () => {
    const chain = new ChainState(GENESIS);
    const ok = chain.addNode("1:1", connected({ startupTime: "1700000000000" }), undefined, 1000);
    const bad = chain.addNode("1:2", connected({ startupTime: "not a number" }), undefined, 1000);

    expect(toFeedNode(ok, chain.getById(ok)!).startupTime).toBe(1_700_000_000_000);
    expect(toFeedNode(bad, chain.getById(bad)!).startupTime).toBeUndefined();
  });

  it("survives JSON serialization (no class instances leak to the wire)", () => {
    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", connected(), undefined, 1000);
    const row = toFeedNode(id, chain.getById(id)!);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });
});

describe("toFeedChain", () => {
  it("exposes the aggregates and the most common label", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", connected(), undefined, 1000);
    chain.addNode("1:2", connected(), undefined, 1000);
    chain.addNode("1:3", connected({ chain: "Other" }), undefined, 1000);
    chain.applyMessage(
      "1:1",
      { msg: "block.import", id: 1, block: { hash: HASH, height: 9 } },
      2000,
    );

    expect(toFeedChain(chain)).toMatchObject({
      genesisHash: GENESIS,
      label: "Orbinum Testnet",
      nodeCount: 3,
      best: { height: 9 },
    });
  });
});

/** A chain holding one node, plus that node's feed id. */
function withNode(overrides: Partial<SystemConnectedMessage["node"]> = {}) {
  const chain = new ChainState(GENESIS);
  const id = chain.addNode("1:1", connected(overrides), undefined, 1000);
  return { chain, id, node: chain.getById(id)! };
}

describe("immutable fields", () => {
  it("carries the target triple and sysinfo only when asked", () => {
    const { id, node } = withNode({
      targetOs: "linux",
      targetArch: "x86_64",
      targetEnv: "gnu",
      sysinfo: { cpu: "AMD Ryzen 9", memory: 67381755904, coreCount: 16 },
    });

    // A delta omits them: they cannot have changed, and at 500 nodes they are
    // a third of the batch.
    const delta = toFeedNode(id, node);
    expect(delta.targetOs).toBeUndefined();
    expect(delta.sysinfo).toBeUndefined();

    const full = toFeedNode(id, node, true);
    expect(full.targetOs).toBe("linux");
    expect(full.targetArch).toBe("x86_64");
    expect(full.targetEnv).toBe("gnu");
    expect(full.sysinfo?.coreCount).toBe(16);
  });

  it("treats hwbench as session-fixed even though it lands after connect", () => {
    const { chain, id } = withNode();
    chain.applyMessage(
      "1:1",
      { msg: "sysinfo.hwbench", id: 1, cpuHashrateScore: 1141, memoryMemcpyScore: 15832 },
      2000,
    );
    const node = chain.getById(id)!;

    // The DO reintroduces the node when hwbench lands, so the full row is what
    // delivers it; repeating it in every delta would cost ~18% of the batch
    // for a value that never changes again.
    expect(toFeedNode(id, node).hwbench).toBeUndefined();
    expect(toFeedNode(id, node, true).hwbench?.cpuHashrateScore).toBe(1141);
  });
});

describe("toFeedNodeSeries", () => {
  it("materializes the four chart series", () => {
    const { chain, id } = withNode();
    chain.applyMessage(
      "1:1",
      {
        msg: "system.interval",
        id: 1,
        bandwidthUpload: 1000,
        bandwidthDownload: 2000,
        usedStateCacheSize: 30,
      },
      5000,
    );

    const series = toFeedNodeSeries(id, chain.getById(id)!);
    expect(series.id).toBe(id);
    expect(series.upload).toEqual([1000]);
    expect(series.download).toEqual([2000]);
    expect(series.usedStateCacheSize).toEqual([30]);
    expect(series.chartStamps).toEqual([5000]);
  });
});
