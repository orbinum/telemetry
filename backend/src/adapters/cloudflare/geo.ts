/**
 * `GeoResolver` over what Cloudflare attaches to a request.
 *
 * `request.cf` carries geolocation on every plan, which is what removes the
 * GeoIP database and the asynchronous lookup pipeline a self-hosted deployment
 * would need. `CF-Connecting-IP` is set by the edge and cannot be spoofed,
 * which replaces the usual Forwarded → X-Forwarded-For → X-Real-IP cascade —
 * a host behind its own proxy has to reinstate that, along with knowing which
 * proxies it trusts.
 */

import type { NodeGeo } from "../../domain/node-state";
import type { GeoResolver } from "../../ports/edge";

export const cloudflareGeo: GeoResolver = {
  clientIp(request: Request): string {
    // "local" outside Cloudflare, i.e. wrangler dev.
    return request.headers.get("CF-Connecting-IP") ?? "local";
  },

  locate(request: Request): NodeGeo | undefined {
    const cf = request.cf;
    if (!cf) return undefined;
    // `request.cf` types these as unknown, so each is narrowed rather than
    // asserted: a field the edge did not fill simply leaves the column empty.
    return {
      city: text(cf.city),
      country: text(cf.country),
      latitude: numeric(cf.latitude),
      longitude: numeric(cf.longitude),
    };
  },
};

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
