/**
 * `/submit` — the node ingest upgrade. Validates that the request is a
 * WebSocket upgrade, throttles connection churn, attaches the geo header
 * (request.cf dies at the DO boundary), and hands the socket to this
 * client's gateway partition. No parsing here.
 */

import type { Context } from "hono";
import type { AppEnv } from "../app-env";
import { GEO_HEADER, geoHeaderValue } from "../gateway-do/geo-header";

export async function submit(c: Context<AppEnv>): Promise<Response> {
  if (c.req.raw.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }

  const { registry, geo, limiters } = c.get("deps");
  const ip = geo.clientIp(c.req.raw);
  if (!(await limiters.submit.allow(ip))) {
    return new Response("too many connection attempts", { status: 429 });
  }

  const forward = new Request("https://do/submit", c.req.raw);
  forward.headers.set(GEO_HEADER, geoHeaderValue(geo.locate(c.req.raw)));
  return registry.gatewayFor(ip).fetch(forward);
}
