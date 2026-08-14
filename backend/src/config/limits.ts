/**
 * Public-endpoint limits (plan §6).
 *
 * `/submit` is open to the internet, so a single connection must not be able
 * to exhaust a Durable Object. The DO memory ceiling is the limit Cloudflare
 * does **not** publish, which is exactly why these exist.
 */

/** Max node ids one socket may claim before it is closed. */
export const MAX_NODES_PER_CONNECTION = 20;

/** Byte budget per connection: 256 KB/s over a 10s sliding window. */
export const BYTE_BUDGET_WINDOW_MS = 10_000;
export const BYTE_BUDGET_BYTES = 256 * 1024 * (BYTE_BUDGET_WINDOW_MS / 1000);

/** WebSocket close codes we use, in the 4000-4999 application range. */
export const CLOSE_TOO_MANY_NODES = 4001;
export const CLOSE_BYTE_BUDGET = 4002;
export const CLOSE_CHAIN_NOT_ALLOWED = 4003;
