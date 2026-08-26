/**
 * Batching is a cost mechanism, so what these assert is the count of RPCs as
 * much as their content: one call per window instead of one per frame is the
 * whole reason this class exists.
 *
 * The eviction cases matter just as much — collapsing N calls into one must
 * not cost the per-node recovery the old per-message path had.
 */

import { describe, expect, it, vi } from "vitest";
import { IngestBatcher } from "../../../src/app/gateway/ingest-batcher";
import { peerId } from "../../fixtures/peer-id";
import type { NodeConnection } from "../../../src/app/gateway/connection";
import type { NodeMessage, SystemConnectedMessage } from "../../../src/core/protocol/node";

const CHAIN_A = "0x" + "aa".repeat(32);
const CHAIN_B = "0x" + "bb".repeat(32);

function connected(id: number): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: CHAIN_A,
    node: {
      chain: "Orbinum Testnet",
      name: `node-${id}`,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(id),
    },
  };
}

function interval(id: number): NodeMessage {
  return { msg: "system.interval", id, peers: 4 };
}

/** A connection that remembers the connects it was told about, like the real one. */
function fakeConnection(id = "1", remembered: number[] = []) {
  const cache = new Map(remembered.map((n) => [n, connected(n)]));
  return {
    id,
    geo: undefined,
    nodeKey: (messageId: number) => `${id}:${messageId}`,
    recallConnected: (messageId: number) => cache.get(messageId),
  } as unknown as NodeConnection;
}

type Entry = { nodeKey: string; msg: NodeMessage };

/** `unknownPerCall` scripts what each successive RPC reports as forgotten. */
function makeBatcher(unknownPerCall: string[][] = []) {
  const nodeConnected = vi.fn<
    (nodeKey: string, msg: SystemConnectedMessage, geo: undefined) => Promise<void>
  >(async () => {});
  let call = 0;
  const nodeMessages = vi.fn<(batch: Entry[]) => Promise<string[]>>(
    async () => unknownPerCall[call++] ?? [],
  );
  const stub = { nodeConnected, nodeMessages } as never;
  return { nodeConnected, nodeMessages, batcher: new IngestBatcher(() => stub) };
}

describe("batching", () => {
  it("collapses a burst into one RPC", async () => {
    const { batcher, nodeMessages } = makeBatcher();
    const conn = fakeConnection();

    for (let id = 1; id <= 5; id++) {
      batcher.add(CHAIN_A, conn, conn.nodeKey(id), interval(id));
    }
    await batcher.flushAll();

    // The point of the class: 5 frames must not cost 5 billed requests.
    expect(nodeMessages).toHaveBeenCalledTimes(1);
    expect(nodeMessages.mock.calls[0][0]).toHaveLength(5);
  });

  it("preserves arrival order within a batch", async () => {
    const { batcher, nodeMessages } = makeBatcher();
    const conn = fakeConnection();

    batcher.add(CHAIN_A, conn, "1:1", interval(1));
    batcher.add(CHAIN_A, conn, "1:2", interval(2));
    await batcher.flushAll();

    expect(nodeMessages.mock.calls[0][0].map((entry) => entry.nodeKey)).toEqual(["1:1", "1:2"]);
  });

  it("keeps chains in separate batches", async () => {
    const { batcher, nodeMessages } = makeBatcher();
    const conn = fakeConnection();

    batcher.add(CHAIN_A, conn, "1:1", interval(1));
    batcher.add(CHAIN_B, conn, "1:2", interval(2));
    await batcher.flushAll();

    // One RPC each: a chain must never receive another's messages.
    expect(nodeMessages).toHaveBeenCalledTimes(2);
    for (const call of nodeMessages.mock.calls) expect(call[0]).toHaveLength(1);
  });

  it("does nothing when there is nothing buffered", async () => {
    const { batcher, nodeMessages } = makeBatcher();
    await batcher.flushAll();
    expect(nodeMessages).not.toHaveBeenCalled();
  });

  it("starts a fresh batch after a flush", async () => {
    const { batcher, nodeMessages } = makeBatcher();
    const conn = fakeConnection();

    batcher.add(CHAIN_A, conn, "1:1", interval(1));
    await batcher.flushAll();
    batcher.add(CHAIN_A, conn, "1:2", interval(2));
    await batcher.flushAll();

    expect(nodeMessages).toHaveBeenCalledTimes(2);
    expect(nodeMessages.mock.calls[1][0]).toEqual([{ nodeKey: "1:2", msg: interval(2) }]);
  });
});

describe("recovery from an evicted ChainDO", () => {
  it("replays the cached connected and retries", async () => {
    const { batcher, nodeConnected, nodeMessages } = makeBatcher([["1:1"]]);
    const conn = fakeConnection("1", [1]);

    batcher.add(CHAIN_A, conn, "1:1", interval(1));
    await batcher.flushAll();

    expect(nodeConnected).toHaveBeenCalledTimes(1);
    expect(nodeMessages).toHaveBeenCalledTimes(2);
    expect(nodeMessages.mock.calls[1][0]).toEqual([{ nodeKey: "1:1", msg: interval(1) }]);
  });

  it("replays only the nodes the chain forgot", async () => {
    const { batcher, nodeConnected, nodeMessages } = makeBatcher([["1:2"]]);
    const conn = fakeConnection("1", [1, 2]);

    batcher.add(CHAIN_A, conn, "1:1", interval(1));
    batcher.add(CHAIN_A, conn, "1:2", interval(2));
    await batcher.flushAll();

    // Node 1 applied fine; batching must not force it to be replayed too.
    expect(nodeConnected).toHaveBeenCalledTimes(1);
    expect(nodeConnected.mock.calls[0][0]).toBe("1:2");
    expect(nodeMessages.mock.calls[1][0]).toEqual([{ nodeKey: "1:2", msg: interval(2) }]);
  });

  it("drops a forgotten node with no cached connect instead of retrying it", async () => {
    const { batcher, nodeConnected, nodeMessages } = makeBatcher([["1:9"]]);
    // Nothing remembered: the node cannot be rebuilt.
    const conn = fakeConnection("1", []);

    batcher.add(CHAIN_A, conn, "1:9", interval(9));
    await batcher.flushAll();

    expect(nodeConnected).not.toHaveBeenCalled();
    // No second call: retrying would just be rejected again.
    expect(nodeMessages).toHaveBeenCalledTimes(1);
  });
});
