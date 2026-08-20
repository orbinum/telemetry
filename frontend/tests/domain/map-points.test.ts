import { describe, expect, it } from "vitest";
import { computeMapPoints, countUnplaceable } from "../../src/domain/map-points";
import type { FeedNode } from "../../../shared/protocol/feed";

function node(id: number, overrides: Partial<FeedNode> = {}): FeedNode {
  return {
    id,
    name: `node-${id}`,
    implementation: "Orbinum Node",
    version: "1.0.0",
    nodeType: "rpc",
    stale: false,
    ...overrides,
  };
}

const santiago = { city: "Santiago", country: "CL", latitude: -33.45, longitude: -70.67 };

describe("computeMapPoints", () => {
  it("carries the coordinates through for MapLibre to project", () => {
    const [point] = computeMapPoints([node(1, { geo: santiago })]);
    expect(point.latitude).toBe(-33.45);
    expect(point.longitude).toBe(-70.67);
  });

  it("collapses nodes at one location into a single marker", () => {
    const points = computeMapPoints([
      node(1, { geo: santiago, nodeType: "validator" }),
      node(2, { geo: santiago }),
      node(3, { geo: santiago, stale: true }),
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      label: "Santiago, CL",
      total: 3,
      validators: 1,
      stale: 1,
    });
  });

  it("keeps distant nodes apart", () => {
    const points = computeMapPoints([
      node(1, { geo: santiago }),
      node(2, { geo: { city: "Frankfurt", country: "DE", latitude: 50.1, longitude: 8.68 } }),
    ]);
    expect(points).toHaveLength(2);
  });

  it("drops nodes with no coordinates instead of stacking them at (0,0)", () => {
    // Null Island is in the Atlantic — a marker there reads as a real cluster.
    const points = computeMapPoints([
      node(1, { geo: { city: "Nowhere", country: "XX" } }),
      node(2),
    ]);
    expect(points).toHaveLength(0);
  });

  it("ignores coordinates that are not finite numbers", () => {
    const points = computeMapPoints([
      node(1, { geo: { latitude: Number.NaN, longitude: 10 } }),
      node(2, { geo: { latitude: 10, longitude: Number.POSITIVE_INFINITY } }),
    ]);
    expect(points).toHaveLength(0);
  });

  it("orders markers smallest first, so the biggest draws on top", () => {
    const points = computeMapPoints([
      node(1, { geo: santiago }),
      node(2, { geo: { latitude: 50.1, longitude: 8.68 } }),
      node(3, { geo: { latitude: 50.1, longitude: 8.68 } }),
    ]);
    expect(points.map((p) => p.total)).toEqual([1, 2]);
  });

  it("falls back through city, country, then a placeholder label", () => {
    const [country] = computeMapPoints([
      node(1, { geo: { country: "DE", latitude: 50, longitude: 8 } }),
    ]);
    expect(country.label).toBe("DE");

    const [none] = computeMapPoints([node(2, { geo: { latitude: 1, longitude: 1 } })]);
    expect(none.label).toBe("Unknown location");
  });
});

describe("countUnplaceable", () => {
  it("counts exactly the nodes the map leaves out", () => {
    expect(
      countUnplaceable([node(1, { geo: santiago }), node(2), node(3, { geo: { country: "DE" } })]),
    ).toBe(2);
  });
});
