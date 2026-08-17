import { describe, expect, it } from "vitest";
import { NodeTable } from "../../src/domain/node-table";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

function connected(id: number, name: string, chain = "Orbinum Testnet"): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: GENESIS,
    node: {
      chain,
      name,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(name),
    },
  };
}

describe("identity", () => {
  it("keys nodes by connection and message id, not by name", () => {
    const table = new NodeTable();
    // Three nodes all called the same thing — legal, `--name` is free-form.
    table.add("1:1", connected(1, "validator"), undefined, 1000);
    table.add("1:2", connected(2, "validator"), undefined, 1000);
    table.add("2:1", connected(1, "validator"), undefined, 1000);

    expect(table.size).toBe(3);
    expect(new Set(table.entries().map((e) => e.id)).size).toBe(3);
  });

  it("keeps a node's feed id across re-announcements on the same key", () => {
    const table = new NodeTable();
    const first = table.add("1:1", connected(1, "a"), undefined, 1000);
    expect(table.add("1:1", connected(1, "a"), undefined, 2000)).toBe(first);
  });

  it("hands out distinct ids to distinct keys", () => {
    const table = new NodeTable();
    const a = table.add("1:1", connected(1, "a"), undefined, 1000);
    const b = table.add("1:2", connected(2, "b"), undefined, 1000);
    expect(a).not.toBe(b);
  });

  it("looks a node up by its feed id", () => {
    const table = new NodeTable();
    const id = table.add("1:1", connected(1, "a"), undefined, 1000);
    expect(table.getById(id)?.details.name).toBe("a");
    expect(table.getById(9999)).toBeUndefined();
  });
});

describe("removal", () => {
  it("removes a connection's nodes by prefix without touching lookalikes", () => {
    const table = new NodeTable();
    const one = table.add("1:1", connected(1, "conn1"), undefined, 1000);
    table.add("11:1", connected(1, "conn11"), undefined, 1000);

    // "11:" must not match the "1:" prefix.
    expect(table.removeByPrefix("1:")).toEqual([one]);
    expect(table.has("11:1")).toBe(true);
    expect(table.size).toBe(1);
  });

  it("removes nodes that stopped reporting", () => {
    const table = new NodeTable();
    table.add("a", connected(1, "quiet"), undefined, 1000);
    const fresh = table.add("b", connected(2, "chatty"), undefined, 70_000);

    const removed = table.removeExpired(70_000, 60_000);
    expect(removed).toHaveLength(1);
    expect(removed).not.toContain(fresh);
    expect(table.has("b")).toBe(true);
  });

  it("frees the key so a re-add gets a fresh id", () => {
    const table = new NodeTable();
    const first = table.add("1:1", connected(1, "a"), undefined, 1000);
    table.removeByPrefix("1:");
    expect(table.add("1:1", connected(1, "a"), undefined, 2000)).not.toBe(first);
  });

  it("hands back the departing node, not only its id", () => {
    // A departure is the only moment a session can be closed, and the node's
    // state is unreachable immediately after — so the caller that records it
    // needs the node itself.
    const table = new NodeTable();
    table.add("1:1", connected(1, "leaving"), undefined, 1000);

    const [entry] = table.takeByPrefix("1:");
    expect(entry.node.details.name).toBe("leaving");
    expect(entry.node.connectedAt).toBe(1000);
    expect(table.size).toBe(0);
  });

  it("hands back reaped nodes the same way", () => {
    const table = new NodeTable();
    table.add("a", connected(1, "quiet"), undefined, 1000);
    table.add("b", connected(2, "chatty"), undefined, 70_000);

    const taken = table.takeExpired(70_000, 60_000);
    expect(taken).toHaveLength(1);
    expect(taken[0].node.details.name).toBe("quiet");
    expect(table.has("b")).toBe(true);
  });
});

describe("label", () => {
  it("reports the majority label when nodes disagree", () => {
    const table = new NodeTable();
    table.add("1", connected(1, "a", "Orbinum Testnet"), undefined, 1000);
    table.add("2", connected(2, "b", "Orbinum Testnet"), undefined, 1000);
    table.add("3", connected(3, "c", "Typo Testnet"), undefined, 1000);
    expect(table.label).toBe("Orbinum Testnet");
  });

  it("is empty for an empty table", () => {
    expect(new NodeTable().label).toBe("");
  });
});
