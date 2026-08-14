import { describe, expect, it, vi } from "vitest";
import { GEO_HEADER } from "../../src/middleware/geo";
import { submit } from "../../src/routes/submit";

/** Minimal Hono-context stand-in: the handler only touches req.raw and env. */
function fakeContext(request: Request) {
  const doFetch = vi.fn(async (_req: Request) => new Response("do-response"));
  const env = {
    GATEWAY: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: doFetch })),
    },
  } as unknown as CloudflareBindings;
  return {
    c: { req: { raw: request }, env } as Parameters<typeof submit>[0],
    doFetch,
  };
}

describe("submit route", () => {
  it("rejects plain HTTP requests with 426", async () => {
    const { c, doFetch } = fakeContext(new Request("http://x/submit"));
    const res = await submit(c);
    expect(res.status).toBe(426);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("forwards websocket upgrades to the ingest DO with the geo header", async () => {
    const { c, doFetch } = fakeContext(
      new Request("http://x/submit", { headers: { Upgrade: "websocket" } }),
    );
    const res = await submit(c);

    expect(doFetch).toHaveBeenCalledOnce();
    const forwarded = doFetch.mock.calls[0][0];
    expect(forwarded.headers.get("Upgrade")).toBe("websocket");
    expect(forwarded.headers.get(GEO_HEADER)).toBe("{}"); // no cf outside Cloudflare
    await expect(res.text()).resolves.toBe("do-response");
  });

  it("accepts the Upgrade header case-insensitively", async () => {
    const { c, doFetch } = fakeContext(
      new Request("http://x/submit", { headers: { Upgrade: "WebSocket" } }),
    );
    await submit(c);
    expect(doFetch).toHaveBeenCalledOnce();
  });
});
