/**
 * CORS for the JSON routes.
 *
 * The frontend is served from a different origin than the worker
 * (telemetry.orbinum.network vs telemetry.orbinum.io), so /chains needs
 * explicit CORS. WebSocket upgrades are exempt from CORS by spec, so /feed
 * and /submit need nothing.
 *
 * The data is public by design (a public telemetry endpoint), so any origin
 * may read it; no credentials are ever involved.
 */

import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET"],
  maxAge: 86_400,
});
