/**
 * Connection-churn rate limiting (plan §6).
 *
 * Cloudflare's native rate limiter runs at the edge and only sees the upgrade
 * request, so this throttles clients that open/close sockets in a loop. It
 * does **not** bound traffic on an already-open socket — that is what the
 * per-connection byte budget in the gateway is for.
 *
 * `CF-Connecting-IP` is authoritative at the edge and cannot be spoofed,
 * which replaces the reference's Forwarded → X-Forwarded-For → X-Real-IP
 * cascade entirely.
 */

/** The IP to attribute a request to; "local" outside Cloudflare (wrangler dev). */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

/**
 * Returns true when the request may proceed. A missing binding (local dev)
 * always allows: the limiter is an edge feature, not a correctness one.
 */
export async function allowRequest(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (limiter === undefined) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    // Never let a limiter outage take ingest down.
    return true;
  }
}
