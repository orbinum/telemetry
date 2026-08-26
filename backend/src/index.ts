/**
 * Worker entry point — assembles the app and exports the Durable Objects.
 * Route handlers live in routes/; this file only wires them.
 *
 * `/submit` and `/submit/` are both registered because the chainspec
 * multiaddr (`x-parity-wss/%2Fsubmit%2F`) resolves to a trailing-slash URL,
 * while `--telemetry-url` operators may type it without one (plan §4.1).
 */

import { Hono } from "hono";
import { D1HistoryRepository } from "./platform/cloudflare/d1-history-repository";
import { D1SessionRepository } from "./platform/cloudflare/d1-session-repository";
import { buildDeps } from "./platform/cloudflare/composition";
import { SESSION_RETENTION_MS } from "./core/config/limits";
import type { AppEnv } from "./app/http/app-env";
import { corsMiddleware } from "./app/http/cors";
import { chains } from "./app/http/chains";
import { feed } from "./app/http/feed";
import { history } from "./app/http/history";
import { submit } from "./app/http/submit";
import { uptime } from "./app/http/uptime";

export { ChainDO } from "./platform/cloudflare/chain-do";
export { GatewayDO } from "./platform/cloudflare/gateway-do";

const app = new Hono<AppEnv>();

// Bindings become ports once per request, so no handler below reads `c.env`.
app.use("*", async (c, next) => {
  c.set("deps", buildDeps(c.env));
  await next();
});

app.get("/submit", submit);
app.get("/submit/", submit);
app.get("/feed/:genesisHash", feed);
app.get("/chains", corsMiddleware, chains);
app.get("/history/:genesisHash", corsMiddleware, history);
app.get("/uptime/:genesisHash", corsMiddleware, uptime);

export default {
  fetch: app.fetch,

  /**
   * Nightly rollup and prune of the history tables (wrangler.jsonc `triggers`).
   *
   * Here rather than in the ChainDO alarm on purpose: pruning is maintenance
   * across every chain at once, and running it from a DO would wake an object
   * whose job is live ingest.
   */
  async scheduled(_event: ScheduledController, env: CloudflareBindings): Promise<void> {
    if (env.DB === undefined) return;
    const now = Date.now();
    await new D1HistoryRepository(env.DB).prune(now);
    // Sessions outlive the 60s buckets: one row per connection means a year of
    // them is smaller than a week of raw history.
    await new D1SessionRepository(env.DB).prune(now, SESSION_RETENTION_MS);
  },
} satisfies ExportedHandler<CloudflareBindings>;
