/**
 * `GET /history/:genesisHash` — the chain's past, from D1.
 *
 * This route deliberately never touches a Durable Object. History lives in D1
 * precisely so that opening a chart does not wake the ChainDO that is busy
 * applying a few hundred node messages a second.
 *
 * Wide windows read the hourly rollup instead of the 60s buckets, so a month
 * is ~720 points rather than 43,200 — the payload the browser can actually
 * plot, and the rows D1 actually has to scan.
 */

import type { Context } from "hono";
import { readHistory, readHourlyHistory } from "../db/chain-history";
import { allowRequest, clientIp } from "../middleware/rate-limit";

const GENESIS_RE = /^0x[0-9a-f]{64}$/;

/** Supported windows, and the resolution each one is served at. */
const WINDOWS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const DEFAULT_WINDOW = "24h";

/** Past this width, 60s points are more than a chart can use — roll up. */
const HOURLY_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export async function history(c: Context<{ Bindings: CloudflareBindings }>): Promise<Response> {
  const genesisHash = c.req.param("genesisHash")?.toLowerCase();
  if (genesisHash === undefined || !GENESIS_RE.test(genesisHash)) {
    return Response.json({ error: "expected /history/0x<genesis hash>" }, { status: 400 });
  }

  const requested = c.req.query("window") ?? DEFAULT_WINDOW;
  const windowMs = WINDOWS[requested];
  if (windowMs === undefined) {
    return Response.json(
      { error: `unknown window; expected one of ${Object.keys(WINDOWS).join(", ")}` },
      { status: 400 },
    );
  }

  if (!(await allowRequest(c.env.HISTORY_LIMITER, clientIp(c.req.raw)))) {
    return Response.json({ error: "too many requests" }, { status: 429 });
  }

  const db = c.env.DB;
  if (db === undefined) {
    return Response.json({ error: "history is not configured" }, { status: 503 });
  }

  const from = Date.now() - windowMs;
  const hourly = windowMs > HOURLY_THRESHOLD_MS;

  try {
    const points = hourly
      ? await readHourlyHistory(db, genesisHash, from)
      : await readHistory(db, genesisHash, from);
    return Response.json({
      genesisHash,
      window: requested,
      resolution: hourly ? "1h" : "1m",
      from,
      covers:
        points.length === 0 ? undefined : { from: points[0].bucket, to: points.at(-1)?.bucket },
      points,
    });
  } catch (error) {
    // D1 answers `overloaded` under contention. A chart that fails to load is
    // worth an error; it is not worth a 500 that reads as the service being down.
    console.error("chain history read failed", error);
    return Response.json({ error: "history unavailable" }, { status: 503 });
  }
}
