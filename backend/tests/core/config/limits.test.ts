import { describe, expect, it } from "vitest";
import {
  BYTE_BUDGET_BYTES,
  BYTE_BUDGET_WINDOW_MS,
  MAX_NODES_PER_CONNECTION,
} from "../../../src/core/config/limits";
import { RollingTotal } from "../../../src/core/domain/rolling-total";

describe("byte budget", () => {
  it("is 256 KB/s across the window", () => {
    expect(BYTE_BUDGET_BYTES).toBe(256 * 1024 * 10);
    expect(BYTE_BUDGET_WINDOW_MS).toBe(10_000);
  });

  it("a normal node stays far under budget", () => {
    // Real frames are ~200-600 bytes; a chatty node sends a handful per second.
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    for (let t = 0; t < BYTE_BUDGET_WINDOW_MS; t += 200) total.push(600, t);
    expect(total.total(BYTE_BUDGET_WINDOW_MS - 1)).toBeLessThan(BYTE_BUDGET_BYTES);
  });

  it("a flooding connection breaches the budget", () => {
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    let breached = false;
    for (let t = 0; t < 5000 && !breached; t += 10) {
      breached = total.push(64 * 1024, t) > BYTE_BUDGET_BYTES;
    }
    expect(breached).toBe(true);
  });

  it("the budget recovers once the flood stops", () => {
    const total = new RollingTotal(BYTE_BUDGET_WINDOW_MS);
    total.push(BYTE_BUDGET_BYTES * 2, 0);
    expect(total.total(BYTE_BUDGET_WINDOW_MS)).toBe(0);
  });
});

describe("node cap", () => {
  it("matches the reference's 20 per connection", () => {
    expect(MAX_NODES_PER_CONNECTION).toBe(20);
  });
});
