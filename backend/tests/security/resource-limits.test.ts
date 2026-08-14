/**
 * Resource-exhaustion tests.
 *
 * The DO memory ceiling is the limit Cloudflare does not publish (plan §10,
 * risk #1), so every unbounded structure is a denial-of-service vector.
 * These assert that nothing in the ingest path grows without bound.
 */

import { describe, expect, it } from "vitest";
import {
  BYTE_BUDGET_BYTES,
  BYTE_BUDGET_WINDOW_MS,
  MAX_NODES_PER_CONNECTION,
} from "../../src/config/limits";
import { ChainState } from "../../src/domain/chain-state";
import { MeanList } from "../../src/domain/mean-list";
import { NodeTable } from "../../src/domain/node-table";
import { RollingTotal } from "../../src/domain/rolling-total";
import { RouteTable } from "../../src/gateway-do/route-table";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const GENESIS = "0x" + "ab".repeat(32);

function connected(id: number): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name: `node-${id}`,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: `12D3KooW${id}`,
    },
  };
}

describe("per-node series are bounded", () => {
  it("MeanList never exceeds 20 samples, however many are pushed", () => {
    const list = new MeanList();
    for (let i = 0; i < 100_000; i++) list.push(i);
    expect(list.slice().length).toBeLessThanOrEqual(20);
  });

  it("RollingTotal memory is fixed by the window, not by traffic", () => {
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    for (let t = 0; t < 1_000_000; t += 1) total.push(1, t);
    // Only the last window's worth can still be counted.
    expect(total.total(1_000_000)).toBeLessThanOrEqual(BYTE_BUDGET_WINDOW_MS);
  });

  it("a node's chart series stay bounded under a message flood", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", connected(1), undefined, 0);

    for (let i = 0; i < 10_000; i++) {
      chain.applyMessage(
        "1:1",
        { msg: "system.interval", id: 1, bandwidthUpload: i, bandwidthDownload: i },
        i,
      );
    }

    const node = chain.getById(1)!;
    expect(node.upload.slice().length).toBeLessThanOrEqual(20);
    expect(node.download.slice().length).toBeLessThanOrEqual(20);
    expect(node.chartStamps.slice().length).toBeLessThanOrEqual(20);
  });

  it("chain block-time history stays bounded across many blocks", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", connected(1), undefined, 0);
    for (let h = 1; h <= 5000; h++) {
      chain.applyMessage(
        "1:1",
        { msg: "block.import", id: 1, block: { hash: GENESIS, height: h } },
        h * 1000,
      );
    }
    // The average stays a real number rather than drifting or overflowing.
    expect(chain.averageBlockTime).toBeGreaterThan(0);
    expect(Number.isFinite(chain.averageBlockTime!)).toBe(true);
  });
});

describe("state is reclaimed", () => {
  it("a closed connection leaves nothing behind", () => {
    const table = new NodeTable();
    for (let id = 1; id <= MAX_NODES_PER_CONNECTION; id++) {
      table.add(`7:${id}`, connected(id), undefined, 1000);
    }
    expect(table.size).toBe(MAX_NODES_PER_CONNECTION);

    table.removeByPrefix("7:");
    expect(table.size).toBe(0);
    expect(table.entries()).toEqual([]);
  });

  it("the route table forgets a connection entirely", () => {
    const routes = new RouteTable();
    for (let id = 1; id <= MAX_NODES_PER_CONNECTION; id++) routes.register(3, id, GENESIS);
    expect(routes.nodeCount(3)).toBe(MAX_NODES_PER_CONNECTION);

    routes.dropConnection(3);
    expect(routes.nodeCount(3)).toBe(0);
    expect(routes.resolve(3, 1)).toBeUndefined();
  });

  it("silent nodes are reaped, so a churning attacker cannot accumulate state", () => {
    const chain = new ChainState(GENESIS);
    for (let conn = 1; conn <= 100; conn++) {
      chain.addNode(`${conn}:1`, connected(1), undefined, 1000);
    }
    expect(chain.nodeCount).toBe(100);

    // None of them ever reported again.
    chain.reapExpired(1000 + 60_001, 60_000);
    expect(chain.nodeCount).toBe(0);
  });
});

describe("byte budget", () => {
  it("a flood trips the budget within the window", () => {
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    let tripped = false;
    for (let t = 0; t < 5000 && !tripped; t += 10) {
      tripped = total.push(64 * 1024, t) > BYTE_BUDGET_BYTES;
    }
    expect(tripped).toBe(true);
  });

  it("a well-behaved node never approaches it", () => {
    // Real frames are a few hundred bytes, a handful per second.
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    for (let t = 0; t < BYTE_BUDGET_WINDOW_MS; t += 200) total.push(600, t);
    expect(total.total(BYTE_BUDGET_WINDOW_MS - 1)).toBeLessThan(BYTE_BUDGET_BYTES / 10);
  });

  it("the budget recovers after the flood stops, so it is not a permanent ban", () => {
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    total.push(BYTE_BUDGET_BYTES * 10, 0);
    expect(total.total(BYTE_BUDGET_WINDOW_MS)).toBe(0);
  });
});
