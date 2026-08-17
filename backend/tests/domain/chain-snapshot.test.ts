import { describe, expect, it } from "vitest";
import {
  BUCKET_MS,
  MAX_HISTOGRAM_ENTRIES,
  bucketOf,
  buildSnapshot,
} from "../../src/domain/chain-snapshot";
import { ChainState } from "../../src/domain/chain-state";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const GENESIS = "0x" + "ab".repeat(32);

function hashAt(height: number): string {
  return "0x" + height.toString(16).padStart(64, "0");
}

interface NodeOpts {
  version?: string;
  implementation?: string;
  authority?: boolean;
}

function connected(id: number, name: string, opts: NodeOpts = {}): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: opts.implementation ?? "Orbinum Node",
      version: opts.version ?? "0.2.5",
      networkId: `12D3KooW${name}`,
      authority: opts.authority,
    },
  };
}

describe("bucketOf", () => {
  it("floors to the minute so a repeated alarm overwrites its row", () => {
    const base = 1_800_000_000_000;
    expect(bucketOf(base)).toBe(base);
    expect(bucketOf(base + 1)).toBe(base);
    expect(bucketOf(base + BUCKET_MS - 1)).toBe(base);
    expect(bucketOf(base + BUCKET_MS)).toBe(base + BUCKET_MS);
  });
});

describe("buildSnapshot", () => {
  it("counts nodes, authorities and stale nodes separately", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a", { authority: true }), undefined, 1000);
    chain.addNode("b", connected(2, "b", { authority: true }), undefined, 1000);
    chain.addNode("c", connected(3, "c"), undefined, 1000);

    const snap = chain.snapshot(1000);

    expect(snap.nodeCount).toBe(3);
    expect(snap.authorityCount).toBe(2);
    expect(snap.staleCount).toBe(0);
    expect(snap.genesisHash).toBe(GENESIS);
  });

  it("builds a version histogram, which is how an upgrade rollout is read", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a", { version: "0.2.5" }), undefined, 1000);
    chain.addNode("b", connected(2, "b", { version: "0.2.5" }), undefined, 1000);
    chain.addNode("c", connected(3, "c", { version: "0.2.4" }), undefined, 1000);

    expect(chain.snapshot(1000).versions).toEqual({ "0.2.5": 2, "0.2.4": 1 });
  });

  it("tallies the country of the nodes that have one", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a"), { country: "CL" }, 1000);
    chain.addNode("b", connected(2, "b"), { country: "CL" }, 1000);
    chain.addNode("c", connected(3, "c"), { country: "DE" }, 1000);
    chain.addNode("d", connected(4, "d"), undefined, 1000);

    // The node without geo is simply absent, never counted as "unknown": the
    // histogram describes what is known, and inventing a bucket for the rest
    // makes a missing lookup look like a location.
    expect(chain.snapshot(1000).countries).toEqual({ CL: 2, DE: 1 });
  });

  it("caps the histogram, so a fleet of unique versions can't inflate the row", () => {
    // `version` is a free-form self-reported string. Without the cap, N nodes
    // reporting N distinct versions would write an unbounded row every minute.
    const chain = new ChainState(GENESIS);
    const total = MAX_HISTOGRAM_ENTRIES + 15;
    for (let i = 0; i < total; i++) {
      chain.addNode(`n${i}`, connected(i + 1, `n${i}`, { version: `v${i}` }), undefined, 1000);
    }

    const snap = chain.snapshot(1000);
    expect(Object.keys(snap.versions)).toHaveLength(MAX_HISTOGRAM_ENTRIES);
    // The count itself is never truncated — only the breakdown is.
    expect(snap.nodeCount).toBe(total);
  });

  it("keeps the most common entries when it truncates", () => {
    const chain = new ChainState(GENESIS);
    // One popular version, then enough unique ones to overflow the cap.
    for (let i = 0; i < 5; i++) {
      chain.addNode(`p${i}`, connected(i + 1, `p${i}`, { version: "popular" }), undefined, 1000);
    }
    for (let i = 0; i < MAX_HISTOGRAM_ENTRIES + 5; i++) {
      chain.addNode(`u${i}`, connected(100 + i, `u${i}`, { version: `u${i}` }), undefined, 1000);
    }

    expect(chain.snapshot(1000).versions.popular).toBe(5);
  });

  it("carries the chain aggregates and derives the finality lag", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a"), undefined, 1000);
    chain.applyMessage(
      "a",
      { msg: "block.import", id: 1, block: { hash: hashAt(100), height: 100 } },
      2000,
    );
    chain.applyMessage(
      "a",
      { msg: "notify.finalized", id: 1, block: { hash: hashAt(97), height: 97 } },
      2000,
    );

    const snap = chain.snapshot(2000);
    expect(snap.bestHeight).toBe(100);
    expect(snap.finalizedHeight).toBe(97);
    expect(snap.finalityLag).toBe(3);
  });

  it("leaves the lag absent when either end is missing", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a"), undefined, 1000);

    const snap = chain.snapshot(1000);
    expect(snap.bestHeight).toBeUndefined();
    expect(snap.finalizedHeight).toBeUndefined();
    expect(snap.finalityLag).toBeUndefined();
  });

  it("never reports a negative lag", () => {
    // A stale sweep can recompute best from live nodes while a higher
    // finalized height is still on record. That is a transient, not a chain
    // finalizing ahead of itself, and a negative lag would render as one.
    const snap = buildSnapshot(
      {
        genesisHash: GENESIS,
        nodes: [],
        best: { height: 90 },
        finalized: { height: 95 },
      },
      1000,
    );
    expect(snap.finalityLag).toBe(0);
  });

  it("describes an empty chain without inventing values", () => {
    const snap = new ChainState(GENESIS).snapshot(1000);

    expect(snap.nodeCount).toBe(0);
    expect(snap.authorityCount).toBe(0);
    expect(snap.versions).toEqual({});
    expect(snap.averageBlockTimeMs).toBeUndefined();
  });

  it("is taken after the reaper, so a swept node is not counted", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("a", connected(1, "a"), undefined, 1000);
    chain.addNode("b", connected(2, "b"), undefined, 1000);

    chain.reapExpired(1000 + 61_000);

    expect(chain.snapshot(1000 + 61_000).nodeCount).toBe(0);
  });
});
