/**
 * Hash parsing: substrate nodes send hashes as `0x…` hex strings or as arrays
 * of 32 bytes (reference: json_message/hash.rs).
 */

import type { BlockHash } from "./types";

const HEX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Parse a hash from a `0x…` hex string or an array of 32 bytes.
 * Returns normalized lowercase hex, or null if malformed.
 */
export function parseHash(value: unknown): BlockHash | null {
  if (typeof value === "string") {
    return HEX_HASH_RE.test(value) ? value.toLowerCase() : null;
  }
  if (Array.isArray(value)) {
    if (value.length !== 32) return null;
    let hex = "0x";
    for (const byte of value) {
      if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        return null;
      }
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  }
  return null;
}
