/**
 * What a request handler is given instead of the raw environment.
 *
 * Every field is a port, so this describes what the application needs without
 * saying where any of it comes from — which is why it lives with the ports
 * rather than beside the wiring that happens to satisfy them on one host.
 */

import type { ChainRegistry } from "./chains";
import type { GeoResolver, RateLimiter } from "./edge";
import type { HistoryRepository, SessionRepository } from "./persistence";

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
