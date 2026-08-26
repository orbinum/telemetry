/**
 * The backoff exists to stop every open tab from reconnecting in lockstep, so
 * what matters is the growth, the ceiling, and the spread — a fixed delay
 * would pass none of these.
 */

import { describe, expect, it } from "vitest";
import { ReconnectBackoff } from "./reconnect-backoff";

/** Mid jitter (factor 1.0) isolates the growth curve from the spread. */
const mid = () => 0.5;

describe("ReconnectBackoff", () => {
  it("grows exponentially from the base delay", () => {
    const backoff = new ReconnectBackoff(mid);
    expect(backoff.next()).toBe(2000);
    expect(backoff.next()).toBe(4000);
    expect(backoff.next()).toBe(8000);
  });

  it("caps so a long outage never parks a tab forever", () => {
    const backoff = new ReconnectBackoff(mid);
    for (let i = 0; i < 20; i++) backoff.next();
    expect(backoff.next()).toBe(30_000);
  });

  it("jitters either side of the delay, which is what breaks the lockstep", () => {
    expect(new ReconnectBackoff(() => 0).next()).toBe(1500);
    expect(new ReconnectBackoff(() => 1).next()).toBe(2500);
  });

  it("returns to the base delay once the feed proves itself", () => {
    const backoff = new ReconnectBackoff(mid);
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(2000);
  });

  it("never returns a delay short enough to hammer the object", () => {
    for (const random of [0, 0.5, 0.999]) {
      const backoff = new ReconnectBackoff(() => random);
      for (let i = 0; i < 20; i++) {
        const delay = backoff.next();
        expect(delay).toBeGreaterThanOrEqual(1500);
        expect(delay).toBeLessThanOrEqual(30_000 * 1.25);
      }
    }
  });
});
