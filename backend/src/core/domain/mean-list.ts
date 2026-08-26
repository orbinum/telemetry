/**
 * MeanList — bounded series of at most 20 means with progressive squashing.
 *
 * Faithful port of common/src/mean_list.rs. When the list fills, adjacent
 * means are averaged pairwise and the sampling period doubles (up to 32 ticks
 * per mean); past that point the list rotates. Keeps per-node chart state at
 * a small, constant size — exactly what a DO's memory budget wants (plan §7).
 */

const MAX_MEANS = 20;
const MAX_TICKS_PER_MEAN = 32;

export class MeanList {
  private periodSum = 0;
  private periodCount = 0;
  private meanIndex = 0;
  private means: number[] = Array.from({ length: MAX_MEANS }, () => 0);
  private ticksPerMean = 1;

  /** The materialized means, oldest first. */
  slice(): number[] {
    return this.means.slice(0, this.meanIndex);
  }

  /** Push one sample. Returns true when a new mean was materialized. */
  push(val: number): boolean {
    if (this.meanIndex === MAX_MEANS && this.ticksPerMean < MAX_TICKS_PER_MEAN) {
      this.squashMeans();
    }

    this.periodSum += val;
    this.periodCount += 1;

    if (this.periodCount === this.ticksPerMean) {
      this.pushMean();
      return true;
    }
    return false;
  }

  private pushMean(): void {
    const mean = this.periodSum / this.periodCount;

    if (this.meanIndex === MAX_MEANS && this.ticksPerMean === MAX_TICKS_PER_MEAN) {
      this.means.shift();
      this.means.push(mean);
    } else {
      this.means[this.meanIndex] = mean;
      this.meanIndex += 1;
    }

    this.periodSum = 0;
    this.periodCount = 0;
  }

  private squashMeans(): void {
    this.ticksPerMean *= 2;
    this.meanIndex = MAX_MEANS / 2;

    for (let i = 0; i < MAX_MEANS / 2; i++) {
      this.means[i] = (this.means[i * 2] + this.means[i * 2 + 1]) / 2;
    }
  }
}
