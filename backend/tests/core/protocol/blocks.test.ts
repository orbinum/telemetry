import { describe, expect, it } from "vitest";
import { parseBlockImport, parseNotifyFinalized } from "../../../src/core/protocol/blocks";

const BEST = "0x" + "cd".repeat(32);

describe("parseBlockImport", () => {
  it("parses best + numeric height", () => {
    expect(parseBlockImport(1, { msg: "block.import", best: BEST, height: 42 })).toEqual({
      msg: "block.import",
      id: 1,
      block: { hash: BEST, height: 42 },
    });
  });

  it("rejects a string height — that shape belongs to notify.finalized", () => {
    expect(parseBlockImport(1, { msg: "block.import", best: BEST, height: "42" })).toBeNull();
  });

  it("rejects a missing or malformed hash", () => {
    expect(parseBlockImport(1, { msg: "block.import", height: 42 })).toBeNull();
    expect(parseBlockImport(1, { msg: "block.import", best: "0xnope", height: 42 })).toBeNull();
  });
});

describe("parseNotifyFinalized", () => {
  it("parses best + string height (the protocol's real asymmetry)", () => {
    expect(parseNotifyFinalized(1, { msg: "notify.finalized", best: BEST, height: "50" })).toEqual({
      msg: "notify.finalized",
      id: 1,
      block: { hash: BEST, height: 50 },
    });
  });

  it("rejects a numeric height — that shape belongs to block.import", () => {
    expect(parseNotifyFinalized(1, { msg: "notify.finalized", best: BEST, height: 50 })).toBeNull();
  });

  it("rejects non-numeric height strings", () => {
    expect(
      parseNotifyFinalized(1, { msg: "notify.finalized", best: BEST, height: "many" }),
    ).toBeNull();
    expect(parseNotifyFinalized(1, { msg: "notify.finalized", best: BEST, height: "" })).toBeNull();
  });
});
