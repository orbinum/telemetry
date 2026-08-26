/**
 * `GET /history/:genesisHash` — a public endpoint that takes a path parameter
 * and a query string straight into a database read.
 *
 * What is worth pinning is the validation that stands between them: a chain
 * hash that is not a hash, a window that is not a window, and the resolution
 * switch, which decides whether a month comes back as ~720 points or ~43,200.
 */

import { describe, expect, it, vi } from "vitest";
import { history } from "../../../src/app/http/history";
import type { AppDeps } from "../../../src/app/ports/deps";
import type { ChainHistoryPoint, HistoryRepository } from "../../../src/app/ports/persistence";

const GENESIS = "0x" + "ab".repeat(32);

function point(bucket: number): ChainHistoryPoint {
  return { bucket, nodeCount: 3, authorityCount: 1, staleCount: 0, versions: { "1.0.0": 3 } };
}

function setup(opts: { allow?: boolean; storage?: boolean; points?: ChainHistoryPoint[] } = {}) {
  const readHistory = vi.fn<HistoryRepository["readHistory"]>(async () => opts.points ?? []);
  const readHourlyHistory = vi.fn<HistoryRepository["readHourlyHistory"]>(
    async () => opts.points ?? [],
  );
  const repo = {
    readHistory,
    readHourlyHistory,
    writeSnapshot: vi.fn(async () => {}),
    prune: vi.fn(async () => {}),
  } as unknown as HistoryRepository;

  const deps = {
    limiters: { history: { allow: async () => opts.allow ?? true } },
    geo: { clientIp: () => "203.0.113.7", locate: () => undefined },
    history: opts.storage === false ? undefined : repo,
  } as unknown as AppDeps;

  return { deps, readHistory, readHourlyHistory };
}

/** Drive the handler the way Hono would, with only what it reads. */
/** The response body, as this route shapes it. */
type Body = Record<string, unknown>;

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function call(
  deps: AppDeps,
  params: { hash?: string; window?: string } = {},
): Promise<Response> {
  const c = {
    req: {
      raw: new Request("http://x/history"),
      param: () => params.hash ?? GENESIS,
      query: () => params.window,
    },
    get: () => deps,
  } as unknown as Parameters<typeof history>[0];
  return history(c);
}

describe("input validation", () => {
  it.each([
    ["path traversal", "../../../etc/passwd"],
    ["a partial hash", "0xab"],
    ["non-hex characters", "0x" + "zz".repeat(32)],
    ["an empty value", ""],
    ["SQL-looking input", "0x' OR 1=1--"],
  ])("rejects %s with 400 and never reads storage", async (_label, hash) => {
    const t = setup();
    const res = await call(t.deps, { hash });

    expect(res.status).toBe(400);
    expect(t.readHistory).not.toHaveBeenCalled();
    expect(t.readHourlyHistory).not.toHaveBeenCalled();
  });

  it("normalizes case, so one chain cannot be queried as two", async () => {
    const t = setup();
    await call(t.deps, { hash: GENESIS.toUpperCase() });

    expect(t.readHistory).toHaveBeenCalledWith(GENESIS, expect.any(Number));
  });

  it("rejects a window that is not on the list", async () => {
    const t = setup();
    const res = await call(t.deps, { window: "99d" });

    expect(res.status).toBe(400);
    expect(t.readHistory).not.toHaveBeenCalled();
  });
});

describe("resolution", () => {
  it("serves narrow windows from the 60s buckets", async () => {
    const t = setup();
    const res = await call(t.deps, { window: "24h" });

    expect(t.readHistory).toHaveBeenCalled();
    expect(t.readHourlyHistory).not.toHaveBeenCalled();
    expect((await json(res)).resolution).toBe("1m");
  });

  it("rolls up past the threshold, so a month is not 43,200 points", async () => {
    const t = setup();
    const res = await call(t.deps, { window: "30d" });

    expect(t.readHourlyHistory).toHaveBeenCalled();
    expect(t.readHistory).not.toHaveBeenCalled();
    expect((await json(res)).resolution).toBe("1h");
  });

  it("defaults to 24h when no window is asked for", async () => {
    const t = setup();
    const res = await call(t.deps);
    expect((await json(res)).window).toBe("24h");
  });
});

describe("the answer", () => {
  it("reports the span the points actually cover", async () => {
    const t = setup({ points: [point(1000), point(2000), point(3000)] });
    const body = await json(await call(t.deps));

    // `from` is what was asked for; `covers` is what exists — a chain younger
    // than the window would otherwise look like a gap in the chart.
    expect(body.covers).toEqual({ from: 1000, to: 3000 });
    expect(body.points).toHaveLength(3);
  });

  it("omits the span when there is nothing to cover", async () => {
    const t = setup({ points: [] });
    const body = await json(await call(t.deps));

    expect(body.covers).toBeUndefined();
    expect(body.points).toEqual([]);
  });
});

describe("degrading", () => {
  it("throttles before reading", async () => {
    const t = setup({ allow: false });
    const res = await call(t.deps);

    expect(res.status).toBe(429);
    expect(t.readHistory).not.toHaveBeenCalled();
  });

  it("answers 503 when no storage is configured", async () => {
    const t = setup({ storage: false });
    expect((await call(t.deps)).status).toBe(503);
  });

  it("answers 503 rather than 500 when the read fails", async () => {
    const t = setup();
    vi.mocked(t.readHistory).mockRejectedValueOnce(new Error("overloaded"));

    // D1 answers `overloaded` under contention. A chart that fails to load is
    // worth an error; it is not worth a 500 that reads as the service being down.
    const res = await call(t.deps);
    expect(res.status).toBe(503);
  });
});
