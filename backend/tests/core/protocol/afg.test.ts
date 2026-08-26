import { describe, expect, it } from "vitest";
import { parseAfgAuthoritySet } from "../../../src/core/protocol/afg";

describe("parseAfgAuthoritySet", () => {
  it("reads only authority_id and ignores the rest", () => {
    const msg = parseAfgAuthoritySet(1, {
      msg: "afg.authority_set",
      authority_id: "5Auth",
      authorities: "[…]",
      authority_set_id: "7",
    });
    expect(msg).toEqual({ msg: "afg.authority_set", id: 1, authorityId: "5Auth" });
  });

  it("rejects a missing or non-string authority_id", () => {
    expect(parseAfgAuthoritySet(1, { msg: "afg.authority_set" })).toBeNull();
    expect(parseAfgAuthoritySet(1, { msg: "afg.authority_set", authority_id: 5 })).toBeNull();
  });

  it("rejects the <unknown> placeholder a keyless validator reports", () => {
    expect(
      parseAfgAuthoritySet(1, { msg: "afg.authority_set", authority_id: "<unknown>" }),
    ).toBeNull();
    expect(parseAfgAuthoritySet(1, { msg: "afg.authority_set", authority_id: "" })).toBeNull();
  });
});
