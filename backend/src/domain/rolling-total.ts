/**
 * RollingTotal — sum over a sliding time window, in constant time.
 *
 * Port of common/src/rolling_total.rs: the window is split into
 * fixed-granularity buckets, so adding is O(1) and memory is bounded by
 * `windowMs / granularityMs` regardless of traffic.
 *
 * Used for the per-connection byte budget (plan §6). Pure: time is a
 * parameter, never read from a clock here.
 */

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_GRANULARITY_MS = 1000;

export class RollingTotal {
  private readonly bucketCount: number;
  private readonly granularityMs: number;
  /** Ring buffer of per-bucket sums. */
  private buckets: number[];
  /** Bucket index (absolute, not modulo) of the most recent write. */
  private latestBucket = 0;
  private sum = 0;

  constructor(
    windowMs: number = DEFAULT_WINDOW_MS,
    granularityMs: number = DEFAULT_GRANULARITY_MS,
  ) {
    this.granularityMs = granularityMs;
    this.bucketCount = Math.max(1, Math.ceil(windowMs / granularityMs));
    this.buckets = Array.from({ length: this.bucketCount }, () => 0);
  }

  /** Add `value` at time `now`; returns the new windowed total. */
  push(value: number, now: number): number {
    const bucket = Math.floor(now / this.granularityMs);
    this.expire(bucket);
    this.buckets[bucket % this.bucketCount] += value;
    this.sum += value;
    return this.sum;
  }

  /** The windowed total as of `now`, without adding anything. */
  total(now: number): number {
    this.expire(Math.floor(now / this.granularityMs));
    return this.sum;
  }

  /** Drop buckets that fell out of the window as time moved to `bucket`. */
  private expire(bucket: number): void {
    if (bucket <= this.latestBucket) return;

    const elapsed = bucket - this.latestBucket;
    if (elapsed >= this.bucketCount) {
      // The whole window went by: everything is stale.
      this.buckets.fill(0);
      this.sum = 0;
    } else {
      for (let i = 1; i <= elapsed; i++) {
        const index = (this.latestBucket + i) % this.bucketCount;
        this.sum -= this.buckets[index];
        this.buckets[index] = 0;
      }
    }
    this.latestBucket = bucket;
  }
}
