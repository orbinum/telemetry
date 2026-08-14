/**
 * Validation bounds for untrusted node input.
 *
 * `/submit` is public, so every value a node sends is attacker-controlled.
 * These bounds exist because the protocol itself has none: a single node
 * reporting height 1e308 would otherwise poison the whole chain's tip, and
 * an unbounded name would sit in DO memory forever.
 *
 * The rule is to reject the message rather than clamp it: a value outside
 * these bounds is not a real node, and silently accepting a "fixed" version
 * of it would hide the problem.
 */

/**
 * Highest block height accepted. Substrate's BlockNumber is u32 on most
 * chains; this leaves headroom for u64 chains while staying far inside
 * Number.MAX_SAFE_INTEGER, so arithmetic on it can never lose precision.
 */
export const MAX_BLOCK_HEIGHT = 2 ** 53 - 1;

/** Longest accepted free-form string (name, version, chain label, …). */
export const MAX_STRING_LENGTH = 256;

/** Longest accepted validator address / network id. */
export const MAX_ADDRESS_LENGTH = 128;

/**
 * A valid block height: a non-negative safe integer. Rejects negatives,
 * fractions, Infinity, NaN and anything past the safe-integer range.
 */
export function isValidHeight(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BLOCK_HEIGHT;
}

/** A non-negative finite count (peers, txcount, scores). */
export function isValidCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Bound a free-form string; longer values are rejected, never truncated. */
export function isValidString(value: string, max: number = MAX_STRING_LENGTH): boolean {
  return value.length <= max;
}
