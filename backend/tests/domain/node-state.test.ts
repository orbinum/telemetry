import { describe, expect, it } from "vitest";
import { ChainState } from "../../src/domain/chain-state";
import { NodeState } from "../../src/domain/node-state";
import type { SystemConnectedMessage, SystemIntervalMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);
const HASH_A = "0x" + "01".repeat(32);
const HASH_B = "0x" + "02".repeat(32);

const connected: SystemConnectedMessage = {
  msg: "system.connected",
  id: 1,
  genesisHash: GENESIS,
  node: {
    chain: "Orbinum Testnet",
    name: "validator-1",
    implementation: "Orbinum Node",
    version: "1.2.0",
    networkId: peerId("test"),
  },
};

function interval(fields: Partial<SystemIntervalMessage>): SystemIntervalMessage {
  return { msg: "system.interval", id: 1, ...fields };
}

describe("construction", () => {
  it("captures details, geo and timestamps", () => {
    const node = new NodeState(connected, { city: "Santiago", country: "CL" }, 1234);
    expect(node.details.name).toBe("validator-1");
    expect(node.genesisHash).toBe(GENESIS);
    expect(node.geo?.city).toBe("Santiago");
    expect(node.connectedAt).toBe(1234);
    expect(node.lastSeen).toBe(1234);
    expect(node.best).toBeUndefined();
    expect(node.stale).toBe(false);
  });
});

describe("updateBlock / updateBlockDetails", () => {
  it("moves forward and never rewinds", () => {
    const node = new NodeState(connected, undefined, 1000);
    expect(node.updateBlock({ hash: HASH_B, height: 200 })).toBe(true);
    expect(node.updateBlock({ hash: HASH_A, height: 150 })).toBe(false);
    expect(node.best?.block.height).toBe(200);
  });

  it("computes block time from the previous best's timestamp", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateBlock({ hash: HASH_A, height: 1 });
    node.updateBlockDetails(2000, 0);
    expect(node.best?.blockTime).toBeUndefined(); // first block: no previous stamp

    node.updateBlock({ hash: HASH_B, height: 2 });
    node.updateBlockDetails(8000, 150);
    expect(node.best?.blockTime).toBe(6000);
    expect(node.best?.propagationTime).toBe(150);
  });

  it("clears the stale flag when a new block arrives", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateBlock({ hash: HASH_A, height: 1 });
    node.updateBlockDetails(1000, 0);
    node.updateStale(2000);
    expect(node.stale).toBe(true);
    node.updateBlock({ hash: HASH_B, height: 2 });
    expect(node.stale).toBe(false);
  });
});

describe("updateFinalized", () => {
  it("only moves forward", () => {
    const node = new NodeState(connected, undefined, 1000);
    expect(node.updateFinalized({ hash: HASH_A, height: 90 })).toBe(true);
    expect(node.updateFinalized({ hash: HASH_B, height: 80 })).toBe(false);
    expect(node.finalized?.height).toBe(90);
  });
});

describe("updateInterval", () => {
  it("merges the two half-frames without clobbering each other", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateInterval(interval({ txcount: 5 }), 2000);
    node.updateInterval(interval({ peers: 8, bandwidthUpload: 512 }), 3000);
    expect(node.txcount).toBe(5);
    expect(node.peers).toBe(8);
    expect(node.upload.slice()).toEqual([512]);
  });

  it("keeps zero values (0 is a real value, not absence)", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateInterval(interval({ peers: 0, txcount: 0 }), 2000);
    expect(node.peers).toBe(0);
    expect(node.txcount).toBe(0);
  });
});

describe("stale and expiry", () => {
  it("goes stale when the best block is older than the threshold", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateBlock({ hash: HASH_A, height: 1 });
    node.updateBlockDetails(1000, 0);
    expect(node.updateStale(999)).toBe(false);
    expect(node.updateStale(1001)).toBe(true);
  });

  it("expires strictly after the timeout", () => {
    const node = new NodeState(connected, undefined, 1000);
    expect(node.isExpired(61_000, 60_000)).toBe(false); // exactly at limit
    expect(node.isExpired(61_001, 60_000)).toBe(true);
  });
});

describe("validator and hwbench", () => {
  it("adopts the afg authority address over the connected one", () => {
    const node = new NodeState(
      { ...connected, node: { ...connected.node, validator: "original" } },
      undefined,
      1000,
    );
    expect(node.validator).toBe("original");
    node.setValidatorAddress("5AfgAddress");
    expect(node.validator).toBe("5AfgAddress");
  });

  it("stores hwbench scores", () => {
    const node = new NodeState(connected, undefined, 1000);
    node.updateHwBench({
      msg: "sysinfo.hwbench",
      id: 1,
      cpuHashrateScore: 1000,
      memoryMemcpyScore: 2000,
      diskSequentialWriteScore: 300,
    });
    expect(node.hwbench).toMatchObject({ cpuHashrateScore: 1000, diskSequentialWriteScore: 300 });
  });
});

describe("validator address repeats", () => {
  it("reports the same address on every authority_set, so callers can dedupe", () => {
    // ChainDO skips the D1 write when the address is unchanged; that check
    // reads the node's address *before* applying, so the value has to be
    // stable across repeats for the dedupe to mean anything.
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", connected, undefined, 1000);

    chain.applyMessage("1:1", { msg: "afg.authority_set", id: 1, authorityId: "addr-1" }, 1000);
    expect(chain.getByKey("1:1")?.validator).toBe("addr-1");

    chain.applyMessage("1:1", { msg: "afg.authority_set", id: 1, authorityId: "addr-1" }, 2000);
    expect(chain.getByKey("1:1")?.validator).toBe("addr-1");

    chain.applyMessage("1:1", { msg: "afg.authority_set", id: 1, authorityId: "addr-2" }, 3000);
    expect(chain.getByKey("1:1")?.validator).toBe("addr-2");
  });
});
