import { describe, expect, it } from "vitest";
import { ChainState } from "../../src/domain/chain-state";
import { toFeedChain, toFeedNode } from "../../src/feed/serialize";
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
