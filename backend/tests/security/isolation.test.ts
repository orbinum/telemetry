/**
 * Isolation tests: one node, one connection, or one chain must never affect
 * another. These are the invariants that keep a public endpoint from letting
 * an attacker corrupt data that is not theirs.
 */

import { describe, expect, it, vi } from "vitest";
import { ChainState } from "../../src/core/domain/chain-state";
import { IngestBatcher } from "../../src/app/gateway/ingest-batcher";
import { MessageRouter } from "../../src/app/gateway/message-router";
import { RouteTable } from "../../src/app/gateway/route-table";
import type { ChainDirectoryStore } from "../../src/app/ports/directory";
import type { NodeConnection } from "../../src/app/gateway/connection";
import type { SystemConnectedMessage } from "../../src/core/protocol/node";
import { peerId } from "../fixtures/peer-id";

const CHAIN_A = "0x" + "aa".repeat(32);
const CHAIN_B = "0x" + "bb".repeat(32);

function connected(id: number, genesisHash: string, name = `node-${id}`): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(id),
    },
  };
}

function fakeConnection(id: string) {
  const cache = new Map<number, SystemConnectedMessage>();
  return {
    id,
    geo: undefined,
    nodeKey: (messageId: number) => `${id}:${messageId}`,
    nodeKeyPrefix: `${id}:`,
    isClosed: false,
    close: vi.fn(),
    rememberConnected: (msg: SystemConnectedMessage) => cache.set(msg.id, msg),
    recallConnected: (messageId: number) => cache.get(messageId),
  } as unknown as NodeConnection & { close: ReturnType<typeof vi.fn> };
}

describe("connection isolation", () => {
  it("one connection cannot address another's nodes", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A, "victim"), undefined, 1000);

    // Connection 2 sends a message keyed as if it were connection 1's node.
    // It cannot: the key it is allowed to build always starts with its own id.
    const attackerKey = "2:1";
    expect(
      chain.applyMessage(attackerKey, { msg: "system.interval", id: 1, peers: 999 }, 2000),
    ).toBeUndefined();
    expect(chain.getById(1)?.peers).toBeUndefined();
  });

  it("closing one connection leaves lookalike connections untouched", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A, "one"), undefined, 1000);
    chain.addNode("11:1", connected(1, CHAIN_A, "eleven"), undefined, 1000);
    chain.addNode("111:1", connected(1, CHAIN_A, "hundred"), undefined, 1000);

    chain.removeConnection("1:");

    // Prefix matching must not treat "11:" or "111:" as "1:".
    expect(chain.hasNode("1:1")).toBe(false);
    expect(chain.hasNode("11:1")).toBe(true);
    expect(chain.hasNode("111:1")).toBe(true);
  });

  it("nodes sharing a name stay independent", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A, "same-name"), undefined, 1000);
    chain.addNode("2:1", connected(1, CHAIN_A, "same-name"), undefined, 1000);

    chain.applyMessage("1:1", { msg: "system.interval", id: 1, peers: 5 }, 2000);

    expect(chain.nodeCount).toBe(2);
    const [a, b] = chain.list();
    expect(a.id).not.toBe(b.id);
    // Only the addressed node changed.
    expect([a.node.peers, b.node.peers].filter((p) => p === 5)).toHaveLength(1);
  });
});

describe("chain isolation", () => {
  function router(allowed: Set<string>) {
    const routes = new RouteTable();
    const stubs = new Map<
      string,
      { nodeConnected: ReturnType<typeof vi.fn>; nodeMessages: ReturnType<typeof vi.fn> }
    >();
    const chainStub = (genesisHash: string) => {
      if (!stubs.has(genesisHash)) {
        stubs.set(genesisHash, {
          nodeConnected: vi.fn(async () => {}),
          nodeMessages: vi.fn(async () => [] as string[]),
        });
      }
      return stubs.get(genesisHash)! as never;
    };
    const batcher = new IngestBatcher(chainStub);
    return {
      routes,
      stubs,
      batcher,
      instance: new MessageRouter({
        routes,
        directory: { record: vi.fn(), list: () => [] } as unknown as ChainDirectoryStore,
        allowedChains: allowed,
        chainStub,
        batcher,
        now: () => 1000,
      }),
    };
  }

  it("routes each node to its own chain, even on one socket", async () => {
    const { instance, stubs, batcher } = router(new Set([CHAIN_A, CHAIN_B]));
    const conn = fakeConnection("1");

    await instance.route(conn, connected(1, CHAIN_A));
    await instance.route(conn, connected(2, CHAIN_B));
    await instance.route(conn, { msg: "system.interval", id: 1, peers: 7 });
    await batcher.flushAll();

    // The interval belongs to node 1, so only chain A may see it. Batching
    // must not pool two chains' messages into one call.
    expect(stubs.get(CHAIN_A)!.nodeMessages).toHaveBeenCalledTimes(1);
    expect(stubs.get(CHAIN_A)!.nodeMessages.mock.calls[0][0]).toEqual([
      { nodeKey: "1:1", msg: { msg: "system.interval", id: 1, peers: 7 } },
    ]);
    expect(stubs.get(CHAIN_B)!.nodeMessages).not.toHaveBeenCalled();
  });

  it("a rejected chain never reaches a ChainDO", async () => {
    const { instance, stubs } = router(new Set([CHAIN_A]));
    const conn = fakeConnection("1");

    await instance.route(conn, connected(1, CHAIN_B));

    expect(conn.close).toHaveBeenCalledWith(expect.any(Number), "chain not allowed");
    expect(stubs.has(CHAIN_B)).toBe(false);
  });

  it("an unrouted message is dropped rather than guessing a chain", async () => {
    const { instance, stubs } = router(new Set([CHAIN_A]));
    // No system.connected was ever sent on this connection.
    await instance.route(fakeConnection("9"), { msg: "system.interval", id: 1, peers: 1 });
    expect(stubs.size).toBe(0);
  });
});

describe("chain state integrity", () => {
  it("a lagging node cannot rewind the chain tip", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A), undefined, 1000);
    chain.addNode("1:2", connected(2, CHAIN_A), undefined, 1000);

    chain.applyMessage(
      "1:1",
      { msg: "block.import", id: 1, block: { hash: CHAIN_A, height: 100 } },
      2000,
    );
    chain.applyMessage(
      "1:2",
      { msg: "block.import", id: 2, block: { hash: CHAIN_A, height: 5 } },
      3000,
    );

    expect(chain.best?.height).toBe(100);
  });

  it("a lagging node cannot rewind finalized", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A), undefined, 1000);
    chain.addNode("1:2", connected(2, CHAIN_A), undefined, 1000);

    chain.applyMessage(
      "1:1",
      { msg: "notify.finalized", id: 1, block: { hash: CHAIN_A, height: 90 } },
      2000,
    );
    chain.applyMessage(
      "1:2",
      { msg: "notify.finalized", id: 2, block: { hash: CHAIN_A, height: 1 } },
      3000,
    );

    expect(chain.finalized?.height).toBe(90);
  });

  it("a node that stops reporting stops holding the tip hostage", () => {
    const chain = new ChainState(CHAIN_A);
    chain.addNode("1:1", connected(1, CHAIN_A, "goes-silent"), undefined, 1000);
    chain.addNode("1:2", connected(2, CHAIN_A, "keeps-going"), undefined, 1000);

    // The soon-to-be-silent node grabs a high tip.
    chain.applyMessage(
      "1:1",
      { msg: "block.import", id: 1, block: { hash: CHAIN_A, height: 1000 } },
      1000,
    );

    // Well past the stale window, only the other node reports.
    const later = 1000 + 2 * 60 * 1000 + 1000;
    chain.applyMessage(
      "1:2",
      { msg: "block.import", id: 2, block: { hash: CHAIN_A, height: 20 } },
      later,
    );

    // The stale sweep recomputes the tip from live nodes instead of staying
    // pinned at 1000 forever.
    expect(chain.getById(1)?.stale).toBe(true);
    expect(chain.best?.height).toBe(20);
  });
});
