import { describe, expect, it, vi } from "vitest";
import { allowRequest, clientIp } from "../../src/middleware/rate-limit";

describe("clientIp", () => {
  it("trusts CF-Connecting-IP, which the edge sets and clients cannot forge", () => {
    const request = new Request("http://x/submit", {
      headers: { "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to a fixed key outside Cloudflare (wrangler dev)", () => {
    expect(clientIp(new Request("http://x/submit"))).toBe("local");
  });
});

describe("allowRequest", () => {
  it("allows when there is no limiter bound (local dev)", async () => {
    await expect(allowRequest(undefined, "ip")).resolves.toBe(true);
  });

  it("passes the key through and honours the verdict", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limiter = { limit } as unknown as RateLimit;
    await expect(allowRequest(limiter, "203.0.113.7")).resolves.toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("fails open — a limiter outage must not take ingest down", async () => {
    const limiter = {
      limit: async () => {
        throw new Error("limiter unavailable");
      },
    } as unknown as RateLimit;
    await expect(allowRequest(limiter, "ip")).resolves.toBe(true);
  });
});
