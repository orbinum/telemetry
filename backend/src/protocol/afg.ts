/**
 * Parser for `afg.authority_set` — only `authority_id` is read; the rest of
 * the payload is ignored, like the reference. Nodes send it at verbosity ≥ 1.
 *
 * The address is bounded: it is attacker-controlled, rendered in the UI, and
 * kept in DO memory for the node's lifetime.
 */

import { MAX_ADDRESS_LENGTH, isValidString } from "./limits";
import type { AfgAuthoritySetMessage } from "./types";

export function parseAfgAuthoritySet(
  id: number,
  p: Record<string, unknown>,
): AfgAuthoritySetMessage | null {
  if (typeof p.authority_id !== "string") return null;
  if (!isValidString(p.authority_id, MAX_ADDRESS_LENGTH)) return null;
  return { msg: "afg.authority_set", id, authorityId: p.authority_id };
}
