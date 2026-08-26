/**
 * Envelope tests only — payload parsing is covered per-variant in
 * connected.test.ts / interval.test.ts, and against real frames in
 * fixtures.test.ts.
 */

import { describe, expect, it } from "vitest";
import { parseNodeMessage } from "../../../src/core/protocol/node";
import { peerId } from "../../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);
const BEST = "0x" + "cd".repeat(32);

const connectedPayload = {
  msg: "system.connected",
  genesis_hash: GENESIS,
  chain: "Orbinum Testnet",
  name: "validator-1",
  implementation: "Orbinum Node",
  version: "1.2.0",
  network_id: peerId("test"),
};

describe("envelope", () => {
  it("parses a V2 envelope and keeps its id", () => {
    const msg = parseNodeMessage(
      JSON.stringify({ id: 7, ts: "2026-01-01T00:00:00Z", payload: connectedPayload }),
    );
    expect(msg?.msg).toBe("system.connected");
    expect(msg?.id).toBe(7);
  });

  it("parses a V1 envelope (flattened payload) with id 0", () => {
    const msg = parseNodeMessage(
      JSON.stringify({ ...connectedPayload, ts: "2026-01-01T00:00:00Z", level: "INFO" }),
    );
    expect(msg?.msg).toBe("system.connected");
    expect(msg?.id).toBe(0);
  });

  it("dispatches system.interval payloads", () => {
    const msg = parseNodeMessage(
      JSON.stringify({ id: 3, payload: { msg: "system.interval", peers: 5 } }),
    );
    expect(msg?.msg).toBe("system.interval");
    expect(msg?.id).toBe(3);
  });

  it("rejects a V2 envelope without a numeric id", () => {
    expect(parseNodeMessage(JSON.stringify({ payload: connectedPayload }))).toBeNull();
    expect(parseNodeMessage(JSON.stringify({ id: "7", payload: connectedPayload }))).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseNodeMessage("not json")).toBeNull();
    expect(parseNodeMessage("[1,2,3]")).toBeNull();
    expect(parseNodeMessage('{"foo":1}')).toBeNull();
    expect(parseNodeMessage('"just a string"')).toBeNull();
  });

  it("dispatches every protocol variant", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ msg: "block.import", best: BEST, height: 42 }, "block.import"],
      [{ msg: "notify.finalized", best: BEST, height: "42" }, "notify.finalized"],
      [{ msg: "afg.authority_set", authority_id: "5A" }, "afg.authority_set"],
      [
        { msg: "sysinfo.hwbench", cpu_hashrate_score: 1, memory_memcpy_score: 2 },
        "sysinfo.hwbench",
      ],
    ];
    for (const [payload, expected] of cases) {
      expect(parseNodeMessage(JSON.stringify({ id: 1, payload }))?.msg).toBe(expected);
    }
  });

  it("returns null for unknown variants", () => {
    expect(
      parseNodeMessage(JSON.stringify({ id: 1, payload: { msg: "tx.pool.import", foo: 1 } })),
    ).toBeNull();
  });
});
