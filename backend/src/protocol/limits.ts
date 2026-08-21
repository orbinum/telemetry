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

/**
 * A libp2p PeerId, in the base58 form Substrate reports (`network_id`).
 *
 * Checked as a shape rather than left as a free 128-char string because this
 * is the field a per-node history is keyed on: a length bound alone lets an
 * attacker mint unlimited distinct identities, which is a write amplifier
 * against any per-node table. This narrows that to values that at least look
 * like a PeerId.
 *
 * Deliberately not anchored to `12D3KooW`: that prefix is what an Ed25519 key
 * produces, and every Orbinum node has one today, but an RSA or secp256k1 key
 * yields a different prefix and length. Anchoring to what today's fleet
 * happens to use would silently drop those nodes. The alphabet and the length
 * range are the parts that are actually true of every PeerId.
 *
 * Note this validates *form*, never ownership: `/submit` is public and the
 * value is self-reported, so it identifies a node only as well as the node is
 * honest. See the history design notes.
 */
const PEER_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{46,64}$/;

export function isValidPeerId(value: string): boolean {
  return PEER_ID_RE.test(value);
}

/**
 * Whether an address the node reported is a real one.
 *
 * Substrate fills `validator` / `authority_id` with the literal string
 * `<unknown>` when the node runs with `--validator` but cannot name its
 * authority yet — no session key in the keystore, or the key not yet in the
 * on-chain set. Nodes started at verbosity ≥ 1 send it on connect, so without
 * this check the placeholder lands in the Address column verbatim and, worse,
 * counts as "already has an address", which blocks the D1 restore that would
 * have filled the gap with the last real one.
 *
 * Rejected rather than message-rejected: the rest of `system.connected` is
 * valid and the node must still appear in the table.
 */
export function isRealAddress(value: string): boolean {
  return value !== "<unknown>" && value.length > 0;
}
