/**
 * The rate limiter adapter.
 *
 * Every branch here is a decision to allow. That is deliberate: the limiter
 * throttles connection churn, it does not enforce correctness, so an outage in
 * it must never be what takes ingest down.
 */

import { describe, expect, it, vi } from "vitest";
import { bindingRateLimiter } from "../../../src/platform/cloudflare/rate-limiter";

describe("bindingRateLimiter", () => {
  it("allows when there is no limiter bound (local dev)", async () => {
    await expect(bindingRateLimiter(undefined).allow("ip")).resolves.toBe(true);
  });

  it("passes the key through and honours the verdict", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limiter = bindingRateLimiter({ limit } as unknown as RateLimit);

    await expect(limiter.allow("203.0.113.7")).resolves.toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("fails open — a limiter outage must not take ingest down", async () => {
    const limiter = bindingRateLimiter({
      limit: async () => {
        throw new Error("limiter unavailable");
      },
    } as unknown as RateLimit);

    await expect(limiter.allow("ip")).resolves.toBe(true);
  });
});
