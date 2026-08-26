import { describe, expect, it } from "vitest";
import { frameToText } from "../../src/gateway/frames";

const JSON_FRAME = '{"id":1}';

describe("frameToText", () => {
  it("passes text frames through", () => {
    expect(frameToText(JSON_FRAME)).toBe(JSON_FRAME);
  });

  it("decodes Blob frames (workerd's binaryType) asynchronously", async () => {
    const result = frameToText(new Blob([JSON_FRAME]));
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(JSON_FRAME);
  });

  it("decodes ArrayBuffer frames synchronously", () => {
    const buffer = new TextEncoder().encode(JSON_FRAME).buffer as ArrayBuffer;
    expect(frameToText(buffer)).toBe(JSON_FRAME);
  });

  it("returns null for unsupported payload types", () => {
    expect(frameToText(42)).toBeNull();
    expect(frameToText(null)).toBeNull();
    expect(frameToText({ data: "x" })).toBeNull();
  });
});
