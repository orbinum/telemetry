/**
 * `Clock`, `Deferred` and `Alarms` over a Durable Object's context.
 *
 * The three things a Durable Object provides that a plain process does not:
 * a clock that only advances on I/O, an invocation that can be held open past
 * the response, and one alarm slot that survives eviction.
 */

import type { Alarms, Deferred } from "../../app/ports/runtime";

/**
 * `ctx.waitUntil`, which keeps the invocation alive until the work settles.
 *
 * Without it a write started after the response is killed mid-flight, which is
 * why every best-effort write in the chain goes through here rather than being
 * left to float.
 */
export function durableObjectDeferred(ctx: DurableObjectState): Deferred {
  return {
    run(work: Promise<unknown>): void {
      ctx.waitUntil(work);
    },
  };
}

/**
 * The object's single storage alarm.
 *
 * `pending` is what makes arming idempotent: the reaper reads it before
 * setting one, so a chain gaining a hundred nodes at once still ends up with
 * one alarm rather than a hundred.
 */
export function durableObjectAlarms(ctx: DurableObjectState): Alarms {
  return {
    pending(): Promise<number | null> {
      return ctx.storage.getAlarm();
    },
    async arm(at: number): Promise<void> {
      await ctx.storage.setAlarm(at);
    },
  };
}
