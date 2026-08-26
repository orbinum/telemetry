import { describe, expect, it } from "vitest";
import { nodeTypeOf } from "../../../src/core/domain/node-type";

describe("nodeTypeOf", () => {
  it("calls an authority a validator", () => {
    expect(nodeTypeOf({ authority: true })).toBe("validator");
  });

  it("calls everything else rpc", () => {
    expect(nodeTypeOf({ authority: false })).toBe("rpc");
    // Absent at verbosity 0 on clients that omit the field entirely.
    expect(nodeTypeOf({})).toBe("rpc");
  });
});
