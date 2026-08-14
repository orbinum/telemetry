import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  formatAgo,
  formatHeight,
  formatLocation,
  formatMs,
  formatNumber,
  shortHash,
} from "../../src/utils/format";

describe("absent values", () => {
  it("every formatter spells 'no data' the same way", () => {
    // A row that mixed "-" and "—" for the same meaning was the bug this
    // constant exists to prevent.
    expect(formatMs(undefined)).toBe(NO_VALUE);
    expect(formatAgo(undefined, 0)).toBe(NO_VALUE);
    expect(shortHash(undefined)).toBe(NO_VALUE);
    expect(formatNumber(undefined)).toBe(NO_VALUE);
    expect(formatHeight(undefined)).toBe(NO_VALUE);
    expect(formatLocation(undefined)).toBe(NO_VALUE);
  });
});

describe("formatMs", () => {
  it("uses ms below a second and seconds above", () => {
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(999)).toBe("999ms");
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(6543)).toBe("6.5s");
  });
});

describe("formatAgo", () => {
  const now = 1_000_000;

  it("counts up through seconds, minutes and hours", () => {
    expect(formatAgo(now - 5_000, now)).toBe("5s");
    expect(formatAgo(now - 90_000, now)).toBe("1m");
    expect(formatAgo(now - 7_200_000, now)).toBe("2h");
  });

  it("treats a zero timestamp as absent, not as 1970", () => {
    expect(formatAgo(0, now)).toBe(NO_VALUE);
  });

  it("never shows negative time when a clock is ahead", () => {
    expect(formatAgo(now + 5_000, now)).toBe("0s");
  });
});

describe("formatHeight", () => {
  it("prefixes with # and groups thousands", () => {
    expect(formatHeight({ height: 2639 })).toBe("#2,639");
    expect(formatHeight({ height: 0 })).toBe("#0");
  });
});

describe("shortHash", () => {
  it("keeps both ends so two hashes stay distinguishable", () => {
    expect(shortHash("0x" + "ab".repeat(32))).toBe("0xabab…abab");
  });
});

describe("formatLocation", () => {
  it("joins city and country, or falls back to whichever exists", () => {
    expect(formatLocation({ city: "Santiago", country: "CL" })).toBe("Santiago, CL");
    expect(formatLocation({ city: "Santiago" })).toBe("Santiago");
    expect(formatLocation({ country: "CL" })).toBe("CL");
    expect(formatLocation({})).toBe(NO_VALUE);
  });
});
