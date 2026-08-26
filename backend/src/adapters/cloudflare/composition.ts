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
import type { ChainRegistry } from "../../ports/chains";
import type { GeoResolver, RateLimiter } from "../../ports/edge";
import type { HistoryRepository, SessionRepository } from "../../ports/persistence";

/** What a request handler is given instead of the raw environment. */
export interface AppDeps {
  registry: ChainRegistry;
  geo: GeoResolver;
  /** One limiter per public endpoint, so a busy feed cannot throttle ingest. */
  limiters: {
    submit: RateLimiter;
    feed: RateLimiter;
    history: RateLimiter;
  };
  /**
   * Storage, absent when no database is bound. The routes that need it answer
   * 503 rather than pretending; the ingest path carries on without it.
   */
  history?: HistoryRepository;
  sessions?: SessionRepository;
}

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
