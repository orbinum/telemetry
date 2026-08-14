import { describe, expect, it } from "vitest";
import { computeStatistics } from "../../src/domain/statistics";
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

describe("computeStatistics", () => {
  it("tallies versions and implementations", () => {
    const stats = computeStatistics([
      node(1, { version: "1.0.0" }),
      node(2, { version: "1.0.0" }),
      node(3, { version: "0.9.0", implementation: "Other Node" }),
    ]);
    expect(stats.version.get("1.0.0")).toBe(2);
    expect(stats.version.get("0.9.0")).toBe(1);
    expect(stats.implementation.get("Other Node")).toBe(1);
  });

  it("buckets missing data as 'unknown' instead of dropping the node", () => {
    const stats = computeStatistics([node(1), node(2, { geo: { country: "CL" } })]);
    expect(stats.location.get("unknown")).toBe(1);
    expect(stats.location.get("CL")).toBe(1);
  });

  it("splits validators from full nodes", () => {
    const stats = computeStatistics([node(1, { validator: "5F" }), node(2)]);
    expect(stats.validatorStatus.get("validator")).toBe(1);
    expect(stats.validatorStatus.get("full node")).toBe(1);
  });

  it("computes medians over the nodes that reported a value", () => {
    const stats = computeStatistics([
      node(1, { blockTime: 2000, propagationTime: 0 }),
      node(2, { blockTime: 6000, propagationTime: 100 }),
      node(3, { blockTime: 10_000, propagationTime: 500 }),
      node(4), // reports neither — must not skew the median
    ]);
    expect(stats.medianBlockTime).toBe(6000);
    expect(stats.medianPropagation).toBe(100);
  });

  it("averages the middle pair for an even count", () => {
    const stats = computeStatistics([node(1, { blockTime: 2000 }), node(2, { blockTime: 4000 })]);
    expect(stats.medianBlockTime).toBe(3000);
  });

  it("leaves medians undefined when nothing reported", () => {
    const stats = computeStatistics([node(1), node(2)]);
    expect(stats.medianBlockTime).toBeUndefined();
    expect(stats.medianPropagation).toBeUndefined();
  });

  it("counts stale nodes", () => {
    const stats = computeStatistics([node(1, { stale: true }), node(2), node(3, { stale: true })]);
    expect(stats.staleCount).toBe(2);
  });

  it("handles an empty node list", () => {
    const stats = computeStatistics([]);
    expect(stats.staleCount).toBe(0);
    expect(stats.version.size).toBe(0);
  });
});
