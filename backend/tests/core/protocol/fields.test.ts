import { describe, expect, it } from "vitest";
import {
  INVALID,
  optBoolean,
  optNumber,
  optString,
  reqString,
} from "../../../src/core/protocol/fields";

describe("field helpers", () => {
  it("optString: absent → undefined, string → value, other → INVALID", () => {
    expect(optString(undefined)).toBeUndefined();
    expect(optString(null)).toBeUndefined();
    expect(optString("x")).toBe("x");
    expect(optString(1)).toBe(INVALID);
    expect(optString({})).toBe(INVALID);
  });

  it("optNumber: rejects NaN and Infinity, keeps 0", () => {
    expect(optNumber(undefined)).toBeUndefined();
    expect(optNumber(0)).toBe(0);
    expect(optNumber(1.5)).toBe(1.5);
    expect(optNumber(Number.NaN)).toBe(INVALID);
    expect(optNumber(Infinity)).toBe(INVALID);
    expect(optNumber("1")).toBe(INVALID);
  });

  it("optBoolean: keeps false", () => {
    expect(optBoolean(undefined)).toBeUndefined();
    expect(optBoolean(false)).toBe(false);
    expect(optBoolean(true)).toBe(true);
    expect(optBoolean(0)).toBe(INVALID);
  });

  it("reqString: absent is INVALID, not undefined", () => {
    expect(reqString("x")).toBe("x");
    expect(reqString(undefined)).toBe(INVALID);
    expect(reqString(null)).toBe(INVALID);
    expect(reqString(3)).toBe(INVALID);
  });
});
