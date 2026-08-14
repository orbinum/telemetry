/**
 * Worker entry point — assembles the app and exports the Durable Objects.
 * Route handlers live in routes/; this file only wires them.
 *
 * `/submit` and `/submit/` are both registered because the chainspec
 * multiaddr (`x-parity-wss/%2Fsubmit%2F`) resolves to a trailing-slash URL,
 * while `--telemetry-url` operators may type it without one (plan §4.1).
 */

import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors";
import { chains } from "./routes/chains";
import { feed } from "./routes/feed";
import { submit } from "./routes/submit";

export { ChainDO } from "./chain-do";
export { GatewayDO } from "./gateway-do";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/submit", submit);
app.get("/submit/", submit);
app.get("/feed/:genesisHash", feed);
app.get("/chains", corsMiddleware, chains);

export default app;
