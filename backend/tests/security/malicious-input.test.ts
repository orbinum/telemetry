/**
 * Adversarial input tests.
 *
 * `/submit` is a public endpoint: every field a node sends is
 * attacker-controlled. Each case here corresponds to an attack that was
 * probed against the real parser — the height cases in particular were a
 * *confirmed exploit* before `protocol/limits.ts` existed: one node claiming
 * height 1e308 became the chain's best block permanently and starved every
 * honest node of propagation numbers.
 */

import { describe, expect, it } from "vitest";
import { ChainState } from "../../src/domain/chain-state";
import { toFeedChain, toFeedNode } from "../../src/feed/serialize";
import { MAX_ADDRESS_LENGTH, MAX_STRING_LENGTH } from "../../src/protocol/limits";
import { parseNodeMessage } from "../../src/protocol/node";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

const connectedPayload = {
  msg: "system.connected",
  genesis_hash: GENESIS,
  chain: "Orbinum Testnet",
  name: "validator-1",
  implementation: "Orbinum Node",
  version: "1.0.0",
  network_id: peerId("validator-1"),
};

function parseConnected(overrides: Record<string, unknown>) {
  return parseNodeMessage(
    JSON.stringify({ id: 1, payload: { ...connectedPayload, ...overrides } }),
  );
}

// ─── Prototype pollution ─────────────────────────────────────────────────────

describe("prototype pollution", () => {
  it("ignores __proto__ and constructor keys in every nested object", () => {
    const raw = JSON.stringify({
      id: 1,
      payload: {
        ...connectedPayload,
        ["__proto__"]: { polluted: true },
        constructor: { prototype: { alsoPolluted: true } },
        sysinfo: { ["__proto__"]: { deeplyPolluted: true } },
      },
    });

    expect(() => parseNodeMessage(raw)).not.toThrow();

    const probe = {} as Record<string, unknown>;
    expect(probe.polluted).toBeUndefined();
    expect(probe.alsoPolluted).toBeUndefined();
    expect(probe.deeplyPolluted).toBeUndefined();
  });

  it("does not let a payload key overwrite a parsed field", () => {
    // The parser reads named fields; it never spreads attacker input into
    // the result, so an unexpected key cannot become part of the message.
    const msg = parseConnected({ genesisHash: "0xdeadbeef", node: { name: "injected" } });
    if (msg?.msg !== "system.connected") throw new Error("wrong variant");
    expect(msg.genesisHash).toBe(GENESIS);
    expect(msg.node.name).toBe("validator-1");
  });
});

// ─── Block height poisoning (was a real exploit) ─────────────────────────────

describe("block height poisoning", () => {
  const attack = (height: unknown) =>
    parseNodeMessage(
      JSON.stringify({ id: 1, payload: { msg: "block.import", best: GENESIS, height } }),
    );

  it.each([
    ["absurdly large", 1e308],
    ["past the safe-integer range", Number.MAX_SAFE_INTEGER + 10],
    ["negative", -5],
    ["fractional", 1.5],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a %s height", (_label, height) => {
    expect(attack(height)).toBeNull();
  });

  it("accepts the legitimate range, including genesis", () => {
    expect(attack(0)).not.toBeNull();
    expect(attack(1)).not.toBeNull();
    expect(attack(Number.MAX_SAFE_INTEGER)).not.toBeNull();
  });

  it("a malicious node can no longer poison the chain tip", () => {
    const chain = new ChainState(GENESIS);
    chain.addNode("1:1", parseConnected({}) as SystemConnectedMessage, undefined, 1000);
    chain.addNode(
      "1:2",
      parseConnected({ name: "honest" }) as SystemConnectedMessage,
      undefined,
      1000,
    );

    // The attacker's frame is dropped by the parser, so it never reaches state.
    const poisoned = attack(1e308);
    expect(poisoned).toBeNull();

    chain.applyMessage(
      "1:2",
      { msg: "block.import", id: 2, block: { hash: GENESIS, height: 42 } },
      2000,
    );

    // The honest node owns the tip and gets a real propagation number.
    expect(chain.best?.height).toBe(42);
    expect(toFeedChain(chain).best?.height).toBe(42);
    expect(chain.getById(2)?.best?.propagationTime).toBe(0);
  });
});

describe("finalized height coercion", () => {
  const attack = (height: unknown) =>
    parseNodeMessage(
      JSON.stringify({ id: 1, payload: { msg: "notify.finalized", best: GENESIS, height } }),
    );

  it.each([
    ["hex, which Number() would coerce to 16", "0x10"],
    ["padded, which Number() would trim", "  12  "],
    ["exponential", "1e5"],
    ["negative", "-1"],
    ["fractional", "1.9"],
    ["infinite", "Infinity"],
    ["empty", ""],
    ["non-numeric", "many"],
  ])("rejects a %s height string", (_label, height) => {
    expect(attack(height)).toBeNull();
  });

  it("accepts plain decimal strings, which is what nodes actually send", () => {
    const msg = attack("50");
    if (msg?.msg !== "notify.finalized") throw new Error("wrong variant");
    expect(msg.block.height).toBe(50);
  });
});

// ─── Unbounded values ────────────────────────────────────────────────────────

describe("unbounded values", () => {
  it("rejects oversized free-form strings instead of storing them", () => {
    // Each of these would otherwise live in DO memory for the node's lifetime,
    // and DO memory is the ceiling Cloudflare does not publish (plan §10).
    const huge = "A".repeat(MAX_STRING_LENGTH + 1);
    expect(parseConnected({ name: huge })).toBeNull();
    expect(parseConnected({ chain: huge })).toBeNull();
    expect(parseConnected({ version: huge })).toBeNull();
    expect(parseConnected({ implementation: huge })).toBeNull();
    expect(parseConnected({ sysinfo: { cpu: huge } })).toBeNull();
  });

  it("rejects an oversized validator address", () => {
    const huge = "5".repeat(MAX_ADDRESS_LENGTH + 1);
    expect(parseConnected({ validator: huge })).toBeNull();
    expect(
      parseNodeMessage(
        JSON.stringify({ id: 1, payload: { msg: "afg.authority_set", authority_id: huge } }),
      ),
    ).toBeNull();
  });

  it("accepts realistic lengths", () => {
    expect(parseConnected({ name: "A".repeat(MAX_STRING_LENGTH) })).not.toBeNull();
    expect(parseConnected({ validator: "5".repeat(MAX_ADDRESS_LENGTH) })).not.toBeNull();
  });

  it("rejects negative counts that would render as nonsense", () => {
    const interval = (fields: Record<string, unknown>) =>
      parseNodeMessage(JSON.stringify({ id: 1, payload: { msg: "system.interval", ...fields } }));

    expect(interval({ peers: -1 })).toBeNull();
    expect(interval({ txcount: -100 })).toBeNull();
    expect(interval({ bandwidth_upload: -5 })).toBeNull();
    expect(interval({ peers: 0 })).not.toBeNull(); // zero is legitimate
  });

  it("rejects negative hwbench scores", () => {
    const bench = (fields: Record<string, unknown>) =>
      parseNodeMessage(
        JSON.stringify({
          id: 1,
          payload: {
            msg: "sysinfo.hwbench",
            cpu_hashrate_score: 1,
            memory_memcpy_score: 1,
            ...fields,
          },
        }),
      );

    expect(bench({ cpu_hashrate_score: -1 })).toBeNull();
    expect(bench({ disk_random_write_score: -1 })).toBeNull();
    expect(bench({})).not.toBeNull();
  });
});

// ─── Node identity forging ───────────────────────────────────────────────────

describe("node identity", () => {
  it("rejects envelope ids that are not plain non-negative integers", () => {
    // The id is half of the `connId:messageId` key, so anything exotic here
    // would produce a malformed or colliding node identity.
    for (const id of [-1, 1.5, 1e20, Number.NaN, "1:999", null, {}]) {
      expect(parseNodeMessage(JSON.stringify({ id, payload: connectedPayload }))).toBeNull();
    }
  });

  it("accepts the ids a real node multiplexes with", () => {
    for (const id of [0, 1, 20]) {
      expect(parseNodeMessage(JSON.stringify({ id, payload: connectedPayload }))).not.toBeNull();
    }
  });

  it("refuses a network_id that is merely short enough", () => {
    // `network_id` is the node's PeerId and the identity any per-node history
    // is keyed on. Bounded only by length, one client could mint a new
    // "node" per frame — unbounded cardinality against a keyed table, which
    // is a write amplifier rather than a display bug. The value is still
    // self-reported and unverified; this only makes forging it cost the shape
    // of a real PeerId.
    for (const networkId of ["x".repeat(128), "not a peer id", "", "0OIl".repeat(13)]) {
      expect(
        parseNodeMessage(
          JSON.stringify({ id: 1, payload: { ...connectedPayload, network_id: networkId } }),
        ),
        networkId.slice(0, 20),
      ).toBeNull();
    }
  });
});

// ─── Malformed frames ────────────────────────────────────────────────────────

describe("malformed frames", () => {
  it("never throws, whatever arrives on the socket", () => {
    const frames = [
      "",
      "null",
      "[]",
      "0",
      '"string"',
      "{",
      " ",
      JSON.stringify({ id: 1 }),
      JSON.stringify({ payload: null }),
      JSON.stringify({ id: 1, payload: [] }),
      JSON.stringify({ id: 1, payload: { msg: null } }),
      // Deep nesting: JSON.parse handles it, we must not recurse on it.
      JSON.stringify({ id: 1, payload: { msg: "system.interval", nested: deepObject(200) } }),
    ];

    for (const frame of frames) {
      expect(() => parseNodeMessage(frame), `frame: ${frame.slice(0, 40)}`).not.toThrow();
    }
  });

  it("treats an unknown variant as a no-op, not an error", () => {
    expect(
      parseNodeMessage(JSON.stringify({ id: 1, payload: { msg: "tx.pool.import", foo: 1 } })),
    ).toBeNull();
  });
});

function deepObject(depth: number): unknown {
  let obj: unknown = {};
  for (let i = 0; i < depth; i++) obj = { nested: obj };
  return obj;
}

// ─── Data escaping into the feed ─────────────────────────────────────────────

describe("feed serialization of hostile values", () => {
  it("passes markup through as data, never as markup", () => {
    // The UI renders text nodes, not HTML, so the payload must survive intact
    // rather than being mangled here — sanitizing at this layer would corrupt
    // legitimate names and give a false sense of safety.
    const msg = parseConnected({ name: "<script>alert(1)</script>" });
    if (msg?.msg !== "system.connected") throw new Error("wrong variant");

    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", msg, undefined, 1000);
    const row = toFeedNode(id, chain.getById(id)!);

    expect(row.name).toBe("<script>alert(1)</script>");
    // And it survives a JSON round-trip without breaking the frame.
    expect(JSON.parse(JSON.stringify(row)).name).toBe("<script>alert(1)</script>");
  });

  it("drops an unparseable startupTime rather than emitting NaN", () => {
    const msg = parseConnected({ startup_time: "not-a-number" }) as SystemConnectedMessage;
    const chain = new ChainState(GENESIS);
    const id = chain.addNode("1:1", msg, undefined, 1000);
    expect(toFeedNode(id, chain.getById(id)!).startupTime).toBeUndefined();
  });
});
