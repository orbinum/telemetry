import { describe, expect, it } from "vitest";
import { parseSystemInterval } from "../../../src/core/protocol/interval";

const GENESIS = "0x" + "ab".repeat(32);
const BEST = "0x" + "cd".repeat(32);

describe("parseSystemInterval", () => {
  it("parses an all-empty interval (every field optional)", () => {
    expect(parseSystemInterval(1, { msg: "system.interval" })).toMatchObject({
      msg: "system.interval",
      id: 1,
    });
  });

  it("parses the block-half frame (best/height flattened at top level)", () => {
    const msg = parseSystemInterval(1, {
      msg: "system.interval",
      best: BEST,
      height: 12345,
      finalized_height: 12000,
      finalized_hash: GENESIS,
      txcount: 3,
      used_state_cache_size: 1.5,
    });
    expect(msg?.block).toEqual({ hash: BEST, height: 12345 });
    expect(msg?.finalizedHeight).toBe(12000);
    expect(msg?.finalizedHash).toBe(GENESIS);
    expect(msg?.txcount).toBe(3);
    expect(msg?.usedStateCacheSize).toBe(1.5);
  });

  it("parses the peers-half frame", () => {
    const msg = parseSystemInterval(1, {
      msg: "system.interval",
      peers: 8,
      bandwidth_upload: 1024.5,
      bandwidth_download: 2048.5,
    });
    expect(msg?.peers).toBe(8);
    expect(msg?.bandwidthUpload).toBe(1024.5);
    expect(msg?.bandwidthDownload).toBe(2048.5);
    expect(msg?.block).toBeUndefined();
  });

  it("drops the flattened block silently when incomplete, like serde flatten", () => {
    const onlyBest = parseSystemInterval(1, { msg: "system.interval", best: BEST, peers: 2 });
    expect(onlyBest?.block).toBeUndefined();
    expect(onlyBest?.peers).toBe(2);

    const onlyHeight = parseSystemInterval(1, { msg: "system.interval", height: 10 });
    expect(onlyHeight?.block).toBeUndefined();

    const badBest = parseSystemInterval(1, { msg: "system.interval", best: "0xnope", height: 10 });
    expect(badBest?.block).toBeUndefined();
  });

  it("fails when a known field has the wrong type", () => {
    expect(parseSystemInterval(1, { msg: "system.interval", peers: "many" })).toBeNull();
    expect(parseSystemInterval(1, { msg: "system.interval", finalized_hash: "0x12" })).toBeNull();
  });
});
