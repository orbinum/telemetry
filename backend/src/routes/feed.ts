/**
 * `/feed/:genesisHash` — browser feed upgrade, routed straight to the chain's
 * ChainDO. The genesis hash travels in the URL (plan §3.2): no subscribe
 * message, no gateway hop.
 */

import type { Context } from "hono";
import { allowRequest, clientIp } from "../middleware/rate-limit";
import { chainStub } from "../services/do-registry";

const GENESIS_RE = /^0x[0-9a-f]{64}$/;

export async function feed(c: Context<{ Bindings: CloudflareBindings }>): Promise<Response> {
  const genesisHash = c.req.param("genesisHash")?.toLowerCase();
  if (genesisHash === undefined || !GENESIS_RE.test(genesisHash)) {
    return new Response("expected /feed/0x<genesis hash>", { status: 400 });
  }
  if (c.req.raw.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }

  if (!(await allowRequest(c.env.FEED_LIMITER, clientIp(c.req.raw)))) {
    return new Response("too many connection attempts", { status: 429 });
  }

  return chainStub(c.env, genesisHash).fetch(new Request("https://do/feed", c.req.raw));
}
