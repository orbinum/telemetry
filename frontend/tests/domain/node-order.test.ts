import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  computeOrder,
  matchesQuery,
  nextSort,
  normalizeQuery,
} from "../../src/domain/node-order";
import type { FeedNode } from "../../../shared/protocol/feed";

function node(id: number, overrides: Partial<FeedNode> = {}): FeedNode {
  return {
    id,
    name: `node-${id}`,
    implementation: "Orbinum Node",
    version: "1.0.0",
    stale: false,
    ...overrides,
  };
}

function mapOf(...nodes: FeedNode[]): Map<number, FeedNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("normalizeQuery", () => {
  it("trims and lowercases so the UI can keep the raw input", () => {
    expect(normalizeQuery("  Alpha ")).toBe("alpha");
    expect(normalizeQuery("")).toBe("");
  });
});

describe("matchesQuery", () => {
  it("matches on name substring", () => {
    expect(matchesQuery(node(1, { name: "validator-alpha" }), "alpha")).toBe(true);
    expect(matchesQuery(node(1, { name: "validator-alpha" }), "beta")).toBe(false);
  });

  it("matches on validator address", () => {
    expect(matchesQuery(node(1, { validator: "5FA9nQDVg267" }), "5fa9")).toBe(true);
  });

  it("does not crash on nodes without a validator", () => {
    expect(matchesQuery(node(1), "5fa9")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery(node(1), "")).toBe(true);
  });
});

describe("computeOrder — default sort", () => {
  it("sorts by best height descending, then by name", () => {
    const nodes = mapOf(
      node(1, { name: "b", best: { hash: "0x", height: 10 } }),
      node(2, { name: "a", best: { hash: "0x", height: 20 } }),
      node(3, { name: "a", best: { hash: "0x", height: 10 } }),
    );
    expect(computeOrder(nodes, "")).toEqual([2, 3, 1]);
  });

  it("puts nodes without a block last", () => {
    const nodes = mapOf(
      node(1, { name: "no-block" }),
      node(2, { name: "has-block", best: { hash: "0x", height: 5 } }),
    );
    expect(computeOrder(nodes, "")).toEqual([2, 1]);
  });

  it("filters before sorting", () => {
    const nodes = mapOf(
      node(1, { name: "validator-alpha", best: { hash: "0x", height: 30 }, validator: "5Fabc" }),
      node(2, { name: "validator-beta", best: { hash: "0x", height: 20 }, validator: "5Gxyz" }),
      node(3, { name: "rpc-node", best: { hash: "0x", height: 40 } }),
    );
    expect(computeOrder(nodes, "validator")).toEqual([1, 2]);
    expect(computeOrder(nodes, "5gx")).toEqual([2]);
    expect(computeOrder(nodes, "nothing")).toEqual([]);
  });
});

describe("computeOrder — explicit sorts", () => {
  const nodes = mapOf(
    node(1, { name: "charlie", peers: 5, blockTime: 6000 }),
    node(2, { name: "alpha", peers: 20, blockTime: 2000 }),
    node(3, { name: "bravo", peers: 12 }), // no blockTime
  );

  it("sorts text ascending and descending", () => {
    expect(computeOrder(nodes, "", { key: "name", direction: "asc" })).toEqual([2, 3, 1]);
    expect(computeOrder(nodes, "", { key: "name", direction: "desc" })).toEqual([1, 3, 2]);
  });

  it("sorts numbers ascending and descending", () => {
    expect(computeOrder(nodes, "", { key: "peers", direction: "asc" })).toEqual([1, 3, 2]);
    expect(computeOrder(nodes, "", { key: "peers", direction: "desc" })).toEqual([2, 3, 1]);
  });

  it("keeps missing values last in BOTH directions", () => {
    // A node with no block time is unknown, not "the fastest" — burying it
    // either way is what an operator expects.
    expect(computeOrder(nodes, "", { key: "blockTime", direction: "asc" })).toEqual([2, 1, 3]);
    expect(computeOrder(nodes, "", { key: "blockTime", direction: "desc" })).toEqual([1, 2, 3]);
  });

  it("sorts by location using the rendered label", () => {
    const geo = mapOf(
      node(1, { name: "a", geo: { city: "Santiago", country: "CL" } }),
      node(2, { name: "b", geo: { country: "AR" } }),
      node(3, { name: "c" }),
    );
    expect(computeOrder(geo, "", { key: "location", direction: "asc" })).toEqual([2, 1, 3]);
  });
});

describe("nextSort", () => {
  it("toggles direction when the same column is clicked again", () => {
    expect(nextSort({ key: "peers", direction: "desc" }, "peers")).toEqual({
      key: "peers",
      direction: "asc",
    });
  });

  it("starts text columns ascending and numeric ones descending", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort(DEFAULT_SORT, "peers")).toEqual({ key: "peers", direction: "desc" });
  });
});
