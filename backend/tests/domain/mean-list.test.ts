import { describe, expect, it } from "vitest";
import { MeanList } from "../../src/domain/mean-list";

describe("MeanList", () => {
  it("materializes one mean per sample before the first squash", () => {
    const list = new MeanList();
    for (let i = 1; i <= 5; i++) {
      expect(list.push(i)).toBe(true);
    }
    expect(list.slice()).toEqual([1, 2, 3, 4, 5]);
  });

  it("never grows past 20 means", () => {
    const list = new MeanList();
    for (let i = 0; i < 500; i++) list.push(i);
    expect(list.slice().length).toBeLessThanOrEqual(20);
  });

  it("squashes pairwise when full: 20 means become 10, period doubles", () => {
    const list = new MeanList();
    for (let i = 0; i < 20; i++) list.push(i);
    expect(list.slice()).toHaveLength(20);

    // 21st sample triggers the squash; with ticks_per_mean now 2 it does not
    // materialize a mean yet.
    expect(list.push(100)).toBe(false);
    expect(list.slice()).toEqual([0.5, 2.5, 4.5, 6.5, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5]);

    // The 22nd completes the 2-tick period → mean of (100 + 200) / 2.
    expect(list.push(200)).toBe(true);
    expect(list.slice()).toHaveLength(11);
    expect(list.slice()[10]).toBe(150);
  });

  it("rotates instead of squashing once ticks-per-mean reaches 32", () => {
    const list = new MeanList();
    // Fill through every squash level until ticks_per_mean = 32 and 20 means.
    // Levels: 1→2→4→8→16→32; total samples to saturate: plenty.
    for (let i = 0; i < 20 * 32 * 4; i++) list.push(1);
    expect(list.slice()).toHaveLength(20);

    // A full 32-sample period of zeros must rotate in exactly one new mean.
    for (let i = 0; i < 32; i++) list.push(0);
    const means = list.slice();
    expect(means).toHaveLength(20);
    expect(means[19]).toBe(0);
    expect(means[0]).toBe(1);
  });
});
