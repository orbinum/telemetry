import { describe, expect, it } from "vitest";
import { splitOldStyleVersion } from "../../../src/core/protocol/version";

describe("splitOldStyleVersion", () => {
  // Cases lifted verbatim from the reference's split_old_style_version_works test.
  it.each([
    ["0.9.17-75dd6c7d0-x86_64-linux-gnu", "0.9.17-75dd6c7d0", "x86_64", "linux", "gnu"],
    ["0.9.17-75dd6c7d0-x86_64-linux", "0.9.17-75dd6c7d0", "x86_64", "linux", ""],
    ["0.9.17-x86_64-linux-gnu", "0.9.17", "x86_64", "linux", "gnu"],
    ["0.9.17-x86_64-linux", "0.9.17", "x86_64", "linux", ""],
    ["2.0.0-alpha.5-da487d19d-x86_64-linux", "2.0.0-alpha.5-da487d19d", "x86_64", "linux", ""],
  ])("%s", (input, version, arch, os, env) => {
    expect(splitOldStyleVersion(input)).toEqual({
      version,
      targetArch: arch,
      targetOs: os,
      targetEnv: env,
    });
  });

  it("returns null for strings without the expected shape", () => {
    expect(splitOldStyleVersion("")).toBeNull();
    expect(splitOldStyleVersion("a")).toBeNull();
    expect(splitOldStyleVersion("a-b")).toBeNull();
    expect(splitOldStyleVersion("x86_64-linux-gnu")).toBeNull();
  });
});
