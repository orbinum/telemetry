/**
 * `RateLimiter` over a Cloudflare rate-limiting binding.
 *
 * The binding runs at the edge and only ever sees the upgrade request, so this
 * throttles clients that open and close sockets in a loop. It does not bound
 * traffic on an already-open socket — that is the per-connection byte budget's
 * job, since those frames never reach the edge again.
 */

import type { RateLimiter } from "../../app/ports/edge";

/** Wraps a binding, or allows everything when none is configured. */
export function bindingRateLimiter(limiter: RateLimit | undefined): RateLimiter {
  return {
    async allow(key: string): Promise<boolean> {
      if (limiter === undefined) return true; // local dev has no binding
      try {
        const { success } = await limiter.limit({ key });
        return success;
      } catch {
        // Never let a limiter outage take ingest down.
        return true;
      }
    },
  };
}
