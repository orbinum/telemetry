/**
 * The composition root: the one place that turns Cloudflare bindings into the
 * ports the rest of the code speaks.
 *
 * Everything platform-shaped is decided here, once per request, so no route
 * has to know that a rate limiter is a binding or that a chain is a Durable
 * Object. Hosting this service elsewhere means writing another one of these
 * and nothing else.
 */

import { D1HistoryRepository } from "./d1-history-repository";
import { D1SessionRepository } from "./d1-session-repository";
import { cloudflareGeo } from "./geo";
import { bindingRateLimiter } from "./rate-limiter";
import { durableObjectRegistry } from "./chain-registry";
import type { AppDeps } from "../../app/ports/deps";

export function buildDeps(env: CloudflareBindings): AppDeps {
  return {
    registry: durableObjectRegistry(env),
    geo: cloudflareGeo,
    limiters: {
      submit: bindingRateLimiter(env.SUBMIT_LIMITER),
      feed: bindingRateLimiter(env.FEED_LIMITER),
      history: bindingRateLimiter(env.HISTORY_LIMITER),
    },
    history: env.DB === undefined ? undefined : new D1HistoryRepository(env.DB),
    sessions: env.DB === undefined ? undefined : new D1SessionRepository(env.DB),
  };
}
