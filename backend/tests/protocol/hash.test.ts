import { describe, expect, it } from "vitest";
import { parseHash } from "../../src/protocol/hash";

describe("parseHash", () => {
  it("normalizes hex strings to lowercase", () => {
    expect(parseHash("0x" + "AB".repeat(32))).toBe("0x" + "ab".repeat(32));
  });

  it("accepts an array of 32 bytes", () => {
    const bytes = Array.from({ length: 32 }, (_, i) => i);
    expect(parseHash(bytes)).toBe(
      "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("rejects malformed strings", () => {
    expect(parseHash("ab".repeat(32))).toBeNull(); // missing 0x
    expect(parseHash("0x1234")).toBeNull(); // wrong length
    expect(parseHash("0x" + "zz".repeat(32))).toBeNull(); // not hex
  });

  it("rejects arrays with the wrong length or contents", () => {
    expect(parseHash(Array(31).fill(0))).toBeNull();
    expect(parseHash(Array(33).fill(0))).toBeNull();
    expect(parseHash([...Array(31).fill(0), 256])).toBeNull();
    expect(parseHash([...Array(31).fill(0), -1])).toBeNull();
    expect(parseHash([...Array(31).fill(0), 1.5])).toBeNull();
    expect(parseHash([...Array(31).fill(0), "ff"])).toBeNull();
  });

  it("rejects non-string non-array values", () => {
    expect(parseHash(42)).toBeNull();
    expect(parseHash(null)).toBeNull();
    expect(parseHash(undefined)).toBeNull();
    expect(parseHash({})).toBeNull();
  });
});
