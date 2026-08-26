/**
 * `GET /uptime/:genesisHash` — per-node availability over a window.
 *
 * The question the chain-level history cannot answer: it collapses nodes into
 * histograms on purpose, so "which validator has the worst uptime" and "is
 * this node flapping" need the session table instead.
 *
 * Keyed on each node's self-reported PeerId. Stable for any node with a fixed
 * key — every Orbinum node — but unverified, since `/submit` is public and
 * nothing proves the sender owns it. The response says so, because a number
 * labelled "uptime" reads as authoritative unless it says otherwise.
 */

import type { Context } from "hono";
import type { AppEnv } from "./app-env";

const GENESIS_RE = /^0x[0-9a-f]{64}$/;
const PEER_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{46,64}$/;

const WINDOWS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const DEFAULT_WINDOW = "24h";

export async function uptime(c: Context<AppEnv>): Promise<Response> {
  const genesisHash = c.req.param("genesisHash")?.toLowerCase();
  if (genesisHash === undefined || !GENESIS_RE.test(genesisHash)) {
    return Response.json({ error: "expected /uptime/0x<genesis hash>" }, { status: 400 });
  }

  const requested = c.req.query("window") ?? DEFAULT_WINDOW;
  const windowMs = WINDOWS[requested];
  if (windowMs === undefined) {
    return Response.json(
      { error: `unknown window; expected one of ${Object.keys(WINDOWS).join(", ")}` },
      { status: 400 },
    );
  }

  // Optional: one node's sessions rather than the whole chain's summary.
  const node = c.req.query("node");
  if (node !== undefined && !PEER_ID_RE.test(node)) {
    return Response.json({ error: "node must be a PeerId" }, { status: 400 });
  }

  const deps = c.get("deps");
  if (!(await deps.limiters.history.allow(deps.geo.clientIp(c.req.raw)))) {
    return Response.json({ error: "too many requests" }, { status: 429 });
  }

  const sessions = deps.sessions;
  if (sessions === undefined) {
    return Response.json({ error: "uptime is not configured" }, { status: 503 });
  }

  const now = Date.now();
  const from = now - windowMs;

  try {
    if (node !== undefined) {
      return Response.json({
        genesisHash,
        window: requested,
        networkId: node,
        identity: "self-reported",
        sessions: await sessions.readSessions(genesisHash, node, from),
      });
    }

    const nodes = await sessions.readUptime(genesisHash, from, now);
    return Response.json({
      genesisHash,
      window: requested,
      windowMs,
      // Named rather than implied: every ratio below is against this window,
      // not against how long the node has existed.
      identity: "self-reported",
      nodes,
    });
  } catch (error) {
    console.error("uptime read failed", error);
    return Response.json({ error: "uptime unavailable" }, { status: 503 });
  }
}
