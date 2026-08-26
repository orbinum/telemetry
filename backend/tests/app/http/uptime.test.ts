/**
 * `GET /uptime/:genesisHash` — like history, a public endpoint feeding user
 * input into a database read, with one more parameter to police: `?node=`,
 * which is a PeerId and reaches a query directly.
 */

import { describe, expect, it, vi } from "vitest";
import { uptime } from "../../../src/app/http/uptime";
import { peerId } from "../../fixtures/peer-id";
import type { AppDeps } from "../../../src/app/ports/deps";
import type { SessionRepository } from "../../../src/app/ports/persistence";

const GENESIS = "0x" + "ab".repeat(32);
const NODE = peerId("alpha");

function setup(opts: { allow?: boolean; storage?: boolean } = {}) {
  const readUptime = vi.fn<SessionRepository["readUptime"]>(async () => []);
  const readSessions = vi.fn<SessionRepository["readSessions"]>(async () => []);
  const repo = {
    readUptime,
    readSessions,
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    closeOrphans: vi.fn(async () => 0),
    recordValidatorAddress: vi.fn(async () => {}),
    readLastValidatorAddress: vi.fn(async () => undefined),
    prune: vi.fn(async () => {}),
  } as unknown as SessionRepository;

  const deps = {
    limiters: { history: { allow: async () => opts.allow ?? true } },
    geo: { clientIp: () => "203.0.113.7", locate: () => undefined },
    sessions: opts.storage === false ? undefined : repo,
  } as unknown as AppDeps;

  return { deps, readUptime, readSessions };
}

/** The response body, as this route shapes it. */
type Body = Record<string, unknown>;

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function call(
  deps: AppDeps,
  params: { hash?: string; window?: string; node?: string } = {},
): Promise<Response> {
  const c = {
    req: {
      raw: new Request("http://x/uptime"),
      param: () => params.hash ?? GENESIS,
      query: (key: string) => (key === "node" ? params.node : params.window),
    },
    get: () => deps,
  } as unknown as Parameters<typeof uptime>[0];
  return uptime(c);
}

describe("input validation", () => {
  it.each([
    ["path traversal", "../../../etc/passwd"],
    ["a partial hash", "0xab"],
    ["non-hex characters", "0x" + "zz".repeat(32)],
    ["SQL-looking input", "0x' OR 1=1--"],
  ])("rejects %s with 400 and never reads storage", async (_label, hash) => {
    const t = setup();
    const res = await call(t.deps, { hash });

    expect(res.status).toBe(400);
    expect(t.readUptime).not.toHaveBeenCalled();
  });

  it("rejects a window that is not on the list", async () => {
    const t = setup();
    expect((await call(t.deps, { window: "1h" })).status).toBe(400);
  });

  it.each([
    ["SQL-looking input", "'; DROP TABLE node_sessions;--"],
    ["a non-base58 character", "12D3KooW" + "0".repeat(44)],
    ["too short", "12D3KooW"],
    ["an empty value", ""],
  ])("rejects a node id that is %s", async (_label, node) => {
    const t = setup();
    const res = await call(t.deps, { node });

    // The value reaches a query, so it is checked before it gets there.
    expect(res.status).toBe(400);
    expect(t.readSessions).not.toHaveBeenCalled();
  });

  it("normalizes the chain hash, so one chain is not two", async () => {
    const t = setup();
    await call(t.deps, { hash: GENESIS.toUpperCase() });

    expect(t.readUptime).toHaveBeenCalledWith(GENESIS, expect.any(Number), expect.any(Number));
  });
});

describe("the two shapes of answer", () => {
  it("summarizes the chain when no node is named", async () => {
    const t = setup();
    const body = await json(await call(t.deps));

    expect(t.readUptime).toHaveBeenCalled();
    expect(t.readSessions).not.toHaveBeenCalled();
    expect(body.nodes).toEqual([]);
    // The window is named rather than implied: every figure is against it,
    // not against how long a node has existed.
    expect(body.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("returns one node's sessions when it is", async () => {
    const t = setup();
    const body = await json(await call(t.deps, { node: NODE }));

    expect(t.readSessions).toHaveBeenCalledWith(GENESIS, NODE, expect.any(Number));
    expect(t.readUptime).not.toHaveBeenCalled();
    expect(body.networkId).toBe(NODE);
  });

  it("says the identity is self-reported, either way", async () => {
    const t = setup();
    expect((await json(await call(t.deps))).identity).toBe("self-reported");
    expect((await json(await call(t.deps, { node: NODE }))).identity).toBe("self-reported");
  });
});

describe("degrading", () => {
  it("throttles before reading", async () => {
    const t = setup({ allow: false });
    const res = await call(t.deps);

    expect(res.status).toBe(429);
    expect(t.readUptime).not.toHaveBeenCalled();
  });

  it("answers 503 when no storage is configured", async () => {
    const t = setup({ storage: false });
    expect((await call(t.deps)).status).toBe(503);
  });

  it("answers 503 rather than 500 when the read fails", async () => {
    const t = setup();
    vi.mocked(t.readUptime).mockRejectedValueOnce(new Error("overloaded"));
    expect((await call(t.deps)).status).toBe(503);
  });
});
