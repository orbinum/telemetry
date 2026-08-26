/**
 * Reconnect backoff for the feed socket.
 *
 * A fixed retry delay makes every open tab reconnect in lockstep the moment a
 * chain's Durable Object blips, and each attempt costs a billed request plus a
 * full init snapshot. The jitter matters as much as the growth: without it
 * clients stay synchronized, only slower.
 *
 * Its own module so the policy is testable without a WebSocket, and so the
 * feed client is left holding only socket lifecycle.
 */

const BASE_MS = 2000;
const MAX_MS = 30_000;
/** Spread applied either side of the delay, as a fraction. */
const JITTER = 0.25;

export class ReconnectBackoff {
  private attempt = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** The next delay, in ms, advancing the backoff by one step. */
  next(): number {
    const capped = Math.min(BASE_MS * 2 ** this.attempt, MAX_MS);
    this.attempt++;
    return Math.round(capped * (1 - JITTER + this.random() * JITTER * 2));
  }

  /** Back to the base delay — the connection proved itself. */
  reset(): void {
    this.attempt = 0;
  }
}
