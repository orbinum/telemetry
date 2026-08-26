/**
 * Parsers for `block.import` and `notify.finalized`.
 *
 * Both carry `best` (hash) + `height`, but the height types differ on the
 * wire: block.import sends a JSON number, notify.finalized sends a string.
 * That asymmetry is real (json_message/node_message.rs: `Block.height:
 * BlockNumber` vs `Finalized.height: Box<str>`) and is the most likely bug
 * in the whole project (plan §7) — hence one parser per shape.
 *
 * Heights are validated, not trusted: `/submit` is public, and a single node
 * claiming height 1e308 would otherwise become the chain's best block forever
 * and starve every honest node of propagation numbers.
 */

import { parseHash } from "./hash";
import { isValidHeight } from "./limits";
import type { BlockImportMessage, NotifyFinalizedMessage } from "./types";

/** Parse a `block.import` payload — height is a JSON number. */
export function parseBlockImport(
  id: number,
  p: Record<string, unknown>,
): BlockImportMessage | null {
  const hash = parseHash(p.best);
  if (hash === null) return null;
  if (typeof p.height !== "number" || !isValidHeight(p.height)) return null;
  return { msg: "block.import", id, block: { hash, height: p.height } };
}

/** Parse a `notify.finalized` payload — height is a decimal string. */
export function parseNotifyFinalized(
  id: number,
  p: Record<string, unknown>,
): NotifyFinalizedMessage | null {
  const hash = parseHash(p.best);
  if (hash === null) return null;
  if (typeof p.height !== "string") return null;

  // Strict decimal only: Number() would happily accept "0x10", " 12 " and
  // "1e5", none of which a real node sends.
  if (!/^\d+$/.test(p.height)) return null;

  const height = Number(p.height);
  if (!isValidHeight(height)) return null;
  return { msg: "notify.finalized", id, block: { hash, height } };
}
