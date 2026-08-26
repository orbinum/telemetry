import { describe, expect, it } from "vitest";
import { RollingTotal } from "../../../src/core/domain/rolling-total";

describe("RollingTotal", () => {
  it("sums everything inside the window", () => {
    const total = new RollingTotal(10_000, 1000);
    total.push(100, 0);
    total.push(200, 500);
    expect(total.push(300, 999)).toBe(600);
  });

  it("drops values that fall out of the window", () => {
    const total = new RollingTotal(10_000, 1000);
    total.push(1000, 0);
    expect(total.total(9_999)).toBe(1000); // still inside
    expect(total.total(10_000)).toBe(0); // the bucket rolled off
  });

  it("keeps a sliding sum as time advances bucket by bucket", () => {
    const total = new RollingTotal(3000, 1000);
    total.push(1, 0);
    total.push(2, 1000);
    total.push(3, 2000);
    expect(total.total(2000)).toBe(6);

    // t=3000 pushes out the t=0 bucket.
    expect(total.push(4, 3000)).toBe(9);
    // t=4000 pushes out the t=1000 bucket.
    expect(total.push(5, 4000)).toBe(12);
  });

  it("resets when the whole window is skipped", () => {
    const total = new RollingTotal(10_000, 1000);
    total.push(5000, 0);
    expect(total.push(1, 1_000_000)).toBe(1);
  });

  it("stays bounded in memory regardless of how many pushes happen", () => {
    const total = new RollingTotal(10_000, 1000);
    for (let t = 0; t < 100_000; t += 10) total.push(1, t);
    // Only the last 10s (1000 pushes of 1) can be in the window.
    expect(total.total(99_990)).toBeLessThanOrEqual(1000);
  });

  it("ignores out-of-order timestamps instead of corrupting the sum", () => {
    const total = new RollingTotal(10_000, 1000);
    total.push(10, 5000);
    total.push(10, 1000); // late frame, same window
    expect(total.total(5000)).toBe(20);
  });
});
