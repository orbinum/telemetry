/**
 * Field extraction helpers shared by the payload parsers.
 *
 * Each helper distinguishes "absent" (ok, undefined) from "present but wrong
 * type" (fails the whole message, like serde does). The INVALID sentinel
 * avoids exceptions on the hot path.
 */

export const INVALID = Symbol("invalid");

export type Maybe<T> = T | undefined | typeof INVALID;

export function optString(v: unknown): Maybe<string> {
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : INVALID;
}

export function optNumber(v: unknown): Maybe<number> {
  if (v === undefined || v === null) return undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : INVALID;
}

export function optBoolean(v: unknown): Maybe<boolean> {
  if (v === undefined || v === null) return undefined;
  return typeof v === "boolean" ? v : INVALID;
}

export function reqString(v: unknown): string | typeof INVALID {
  return typeof v === "string" ? v : INVALID;
}
