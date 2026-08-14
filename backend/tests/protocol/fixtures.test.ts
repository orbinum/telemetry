/**
 * Fixture-driven tests: real frames captured from an Orbinum node
 * (ghcr.io/orbinum/node:testnet-latest, --dev, verbosity 1) on 2026-08-14.
 * These freeze the actual wire format so parser regressions surface even if
 * the synthetic tests drift from reality.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNodeMessage } from "../../src/protocol/node";

const frames = readFileSync(join(import.meta.dirname, "../fixtures/node-frames.jsonl"), "utf8")
  .trim()
  .split("\n");

// The six protocol variants; anything else must return null, not throw.
const SUPPORTED = new Set([
  "system.connected",
  "system.interval",
  "block.import",
  "notify.finalized",
  "afg.authority_set",
  "sysinfo.hwbench",
]);

describe("real node frames", () => {
  it("parses every supported frame and rejects the rest without throwing", () => {
    for (const raw of frames) {
      const wireMsg = JSON.parse(raw).payload.msg as string;
      const parsed = parseNodeMessage(raw);
      if (SUPPORTED.has(wireMsg)) {
        expect(parsed, `should parse: ${wireMsg}`).not.toBeNull();
        expect(parsed?.msg).toBe(wireMsg);
      } else {
        expect(parsed, `should reject: ${wireMsg}`).toBeNull();
      }
    }
  });

  it("extracts the node identity from the real system.connected", () => {
    const raw = frames.find((f) => f.includes('"system.connected"'));
    if (raw === undefined) throw new Error("fixture missing system.connected");
    const msg = parseNodeMessage(raw);
    if (msg?.msg !== "system.connected") throw new Error("wrong variant");
    expect(msg.node.name).toBe("telemetry-test-node");
    expect(msg.node.implementation).toBe("Orbinum Node");
    expect(msg.genesisHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(msg.node.targetOs).toBe("linux");
  });

  it("parses the real height asymmetry: block.import number vs notify.finalized string", () => {
    const imported = frames.find((f) => f.includes('"block.import"'));
    const finalized = frames.find((f) => f.includes('"notify.finalized"'));
    if (imported === undefined || finalized === undefined) throw new Error("fixtures missing");

    const importedMsg = parseNodeMessage(imported);
    if (importedMsg?.msg !== "block.import") throw new Error("wrong variant");
    expect(typeof JSON.parse(imported).payload.height).toBe("number");
    expect(importedMsg.block.height).toBeGreaterThan(0);

    const finalizedMsg = parseNodeMessage(finalized);
    if (finalizedMsg?.msg !== "notify.finalized") throw new Error("wrong variant");
    expect(typeof JSON.parse(finalized).payload.height).toBe("string");
    expect(finalizedMsg.block.height).toBeGreaterThan(0);
  });

  it("parses the real afg.authority_set", () => {
    const raw = frames.find((f) => f.includes('"afg.authority_set"'));
    if (raw === undefined) throw new Error("fixture missing afg.authority_set");
    const msg = parseNodeMessage(raw);
    if (msg?.msg !== "afg.authority_set") throw new Error("wrong variant");
    expect(msg.authorityId.length).toBeGreaterThan(0);
  });

  it("merges real interval halves into best and finalized", () => {
    const intervals = frames.filter((f) => f.includes('"system.interval"'));
    expect(intervals.length).toBeGreaterThan(1);
    const parsed = intervals.map((f) => parseNodeMessage(f));
    // At least one frame carries the flattened best block.
    expect(parsed.some((m) => m?.msg === "system.interval" && m.block !== undefined)).toBe(true);
    // And at least one carries the peers half.
    expect(parsed.some((m) => m?.msg === "system.interval" && m.peers !== undefined)).toBe(true);
  });
});
