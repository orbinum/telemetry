/**
 * Parser for the `system.interval` payload — everything optional; real nodes
 * send it as two separate half-frames.
 */

import { INVALID, optNumber } from "./fields";
import { parseHash } from "./hash";
import { isValidCount, isValidHeight } from "./limits";
import type { BlockRef, SystemIntervalMessage } from "./types";

/** Parse a `system.interval` payload, or null if a known field is mistyped. */
export function parseSystemInterval(
  id: number,
  p: Record<string, unknown>,
): SystemIntervalMessage | null {
  const peers = optNumber(p.peers);
  const txcount = optNumber(p.txcount);
  const bandwidthUpload = optNumber(p.bandwidth_upload);
  const bandwidthDownload = optNumber(p.bandwidth_download);
  const finalizedHeight = optNumber(p.finalized_height);
  const usedStateCacheSize = optNumber(p.used_state_cache_size);
  for (const f of [
    peers,
    txcount,
    bandwidthUpload,
    bandwidthDownload,
    finalizedHeight,
    usedStateCacheSize,
  ]) {
    if (f === INVALID) return null;
  }

  // Counts are attacker-controlled: reject negatives rather than render them.
  for (const count of [peers, txcount, bandwidthUpload, bandwidthDownload, usedStateCacheSize]) {
    if (typeof count === "number" && !isValidCount(count)) return null;
  }
  if (typeof finalizedHeight === "number" && !isValidHeight(finalizedHeight)) return null;

  const finalizedHash =
    p.finalized_hash == null ? undefined : (parseHash(p.finalized_hash) ?? INVALID);
  if (finalizedHash === INVALID) return null;

  // Flattened best block: like serde's flattened Option<Block>, it only
  // materializes when both fields are present and valid — never fails.
  let block: BlockRef | undefined;
  const bestHash = parseHash(p.best);
  if (bestHash !== null && typeof p.height === "number" && isValidHeight(p.height)) {
    block = { hash: bestHash, height: p.height };
  }

  return {
    msg: "system.interval",
    id,
    peers: peers as number | undefined,
    txcount: txcount as number | undefined,
    bandwidthUpload: bandwidthUpload as number | undefined,
    bandwidthDownload: bandwidthDownload as number | undefined,
    finalizedHeight: finalizedHeight as number | undefined,
    finalizedHash,
    block,
    usedStateCacheSize: usedStateCacheSize as number | undefined,
  };
}
