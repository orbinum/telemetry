/**
 * Entry point for the node→server telemetry protocol.
 *
 * Owns only the envelope: V2 is `{id, payload}`, V1 is the payload flattened
 * at the top level (its id is 0). Payload parsing lives in one file per
 * variant. Pure functions only: no I/O, no clock, no WebSocket.
 */

import { parseAfgAuthoritySet } from "./afg";
import { parseBlockImport, parseNotifyFinalized } from "./blocks";
import { parseSystemConnected } from "./connected";
import { parseHwBench } from "./hwbench";
import { parseSystemInterval } from "./interval";
import type { NodeMessage } from "./types";

export type * from "./types";
export { parseHash } from "./hash";
export { splitOldStyleVersion } from "./version";

/** Envelope + payload extraction, shared by parse and peek. */
function extractPayload(raw: string): { id: number; payload: Record<string, unknown> } | null {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  const envelope = root as Record<string, unknown>;

  // V1 has `msg` at the top level; V2 nests the payload under `payload`.
  if (typeof envelope.msg === "string") {
    return { id: 0, payload: envelope };
  }
  if (
    typeof envelope.payload === "object" &&
    envelope.payload !== null &&
    !Array.isArray(envelope.payload) &&
    typeof (envelope.payload as Record<string, unknown>).msg === "string"
  ) {
    // The id becomes half of a node's identity key, so it must be a plain
    // non-negative integer — `-1`, `1.5` and `1e20` are not real node ids.
    if (typeof envelope.id !== "number" || !Number.isSafeInteger(envelope.id) || envelope.id < 0) {
      return null;
    }
    return { id: envelope.id, payload: envelope.payload as Record<string, unknown> };
  }
  return null;
}

/**
 * Parse one raw frame from a node socket. Returns null for malformed frames
 * and for `msg` variants outside the six the protocol defines.
 */
export function parseNodeMessage(raw: string): NodeMessage | null {
  const extracted = extractPayload(raw);
  if (extracted === null) return null;
  const { id, payload } = extracted;

  switch (payload.msg) {
    case "system.connected":
      return parseSystemConnected(id, payload);
    case "system.interval":
      return parseSystemInterval(id, payload);
    case "block.import":
      return parseBlockImport(id, payload);
    case "notify.finalized":
      return parseNotifyFinalized(id, payload);
    case "afg.authority_set":
      return parseAfgAuthoritySet(id, payload);
    case "sysinfo.hwbench":
      return parseHwBench(id, payload);
    default:
      return null;
  }
}

/**
 * The `msg` name of a frame that failed to parse — used to log unknown
 * variants at debug level without paying for it on the happy path (plan §9,
 * Fase 2: unknown variants must not be discarded silently).
 */
export function peekMessageName(raw: string): string | null {
  const extracted = extractPayload(raw);
  if (extracted === null) return null;
  const msg = extracted.payload.msg;
  return typeof msg === "string" ? msg : null;
}
