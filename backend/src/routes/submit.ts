/**
 * `/submit` — the node ingest upgrade. Validates that the request is a
 * WebSocket upgrade, throttles connection churn, attaches the geo header
 * (request.cf dies at the DO boundary), and hands the socket to this
 * client's gateway partition. No parsing here.
 */

import type { Context } from "hono";
import { GEO_HEADER, geoHeaderValue } from "../middleware/geo";
import { allowRequest, clientIp } from "../middleware/rate-limit";
import { gatewayStub } from "../services/do-registry";

export async function submit(c: Context<{ Bindings: CloudflareBindings }>): Promise<Response> {
  if (c.req.raw.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }

  const ip = clientIp(c.req.raw);
  if (!(await allowRequest(c.env.SUBMIT_LIMITER, ip))) {
    return new Response("too many connection attempts", { status: 429 });
  }

  const forward = new Request("https://do/submit", c.req.raw);
  forward.headers.set(GEO_HEADER, geoHeaderValue(c.req.raw));
  return gatewayStub(c.env, ip).fetch(forward);
}
