/**
 * What the code needs from the runtime it happens to be hosted by: the clock,
 * a place to put work whose failure must not fail the caller, and one pending
 * wakeup.
 *
 * These three are the reason a port layer exists at all. Everything else in
 * this directory has an obvious equivalent everywhere; `waitUntil` and a
 * durable alarm do not.
 */

/**
 * Wall clock.
 *
 * A function rather than an interface because that is the shape the code
 * already injects — see `MessageRouterDeps.now`. Workers advance `Date.now()`
 * only on I/O, which is why the domain takes `now` as a parameter everywhere
 * and only the shell reads a clock.
 */
export type Clock = () => number;

/**
 * Fire-and-forget work.
 *
 * On Workers this is `ctx.waitUntil`: the runtime keeps the invocation alive
 * until the promise settles, which is the only way a write that outlives the
 * response completes at all. A long-lived process has no invocation to extend,
 * so there the implementation is a floating promise with a logged catch.
 *
 * Either way the contract to the caller is the same, and it is the one every
 * existing call site already assumes: the work is started, nothing waits for
 * it, and its failure is the implementation's problem rather than the
 * caller's.
 */
export interface Deferred {
  run(work: Promise<unknown>): void;
}

/**
 * One pending wakeup.
 *
 * Deliberately a single slot rather than a schedule/cancel pair, because that
 * is what a Durable Object's storage alarm is and what the arm-if-unset idiom
 * in the reaper depends on: reading the pending time is how the chain avoids
 * stacking an alarm per connecting node.
 */
export interface Alarms {
  /** Wall-clock ms of the pending alarm, or null if none is armed. */
  pending(): Promise<number | null>;
  /** Set the pending alarm, replacing any current one. */
  arm(at: number): Promise<void>;
}
