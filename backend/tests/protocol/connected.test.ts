import { describe, expect, it } from "vitest";
import { parseSystemConnected } from "../../src/protocol/connected";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

const payload = {
  msg: "system.connected",
  genesis_hash: GENESIS,
  chain: "Orbinum Testnet",
  name: "validator-1",
  implementation: "Orbinum Node",
  version: "1.2.0-abcdef123-x86_64-linux-gnu",
  network_id: peerId("test"),
};

describe("parseSystemConnected", () => {
  it("reads the authority flag, which is how a validator identifies itself", () => {
    // What a real `--validator` node sends at verbosity 0: `authority: true`
    // and no `validator` field at all. The address comes later, over
    // `afg.authority_set`, which the client only emits at verbosity 1+ — so
    // reading the address alone labelled every validator a full node.
    const msg = parseSystemConnected(1, { ...payload, authority: true });
    expect(msg?.node.authority).toBe(true);
    expect(msg?.node.validator).toBeUndefined();
  });

  it("treats a node without the flag as a full node", () => {
    expect(parseSystemConnected(1, payload)?.node.authority).toBe(false);
    // Only a literal `true` counts — a truthy string must not promote a node.
    expect(parseSystemConnected(1, { ...payload, authority: "yes" })?.node.authority).toBe(false);
  });

  it("parses required and optional fields", () => {
    const msg = parseSystemConnected(1, {
      ...payload,
      validator: "5F3sa2TJ",
      startup_time: "1700000000000",
      target_os: "linux",
      target_arch: "x86_64",
      target_env: "gnu",
      ip: "1.2.3.4",
      sysinfo: {
        cpu: "AMD EPYC",
        memory: 68719476736,
        core_count: 16,
        linux_kernel: "6.8.0",
        linux_distro: "Ubuntu 24.04",
        is_virtual_machine: false,
      },
    });
    expect(msg).toMatchObject({
      msg: "system.connected",
      id: 1,
      genesisHash: GENESIS,
      node: {
        chain: "Orbinum Testnet",
        name: "validator-1",
        validator: "5F3sa2TJ",
        targetOs: "linux",
        sysinfo: { coreCount: 16, isVirtualMachine: false },
      },
    });
    // targets provided explicitly → version left untouched
    expect(msg?.node.version).toBe("1.2.0-abcdef123-x86_64-linux-gnu");
  });

  it("fails when a required field is missing", () => {
    for (const field of [
      "genesis_hash",
      "chain",
      "name",
      "implementation",
      "version",
      "network_id",
    ]) {
      const p: Record<string, unknown> = { ...payload };
      delete p[field];
      expect(parseSystemConnected(1, p), `missing ${field}`).toBeNull();
    }
  });

  describe("network_id", () => {
    // This is the field a per-node history is keyed on, so its shape is
    // checked rather than only its length: a free 128-char string lets one
    // client mint unlimited distinct identities.
    it("accepts the PeerIds real nodes report", () => {
      // Captured from a live Substrate client, and the five production nodes
      // recorded in node-deploy's TOPOLOGY.md.
      for (const id of [
        "12D3KooWF4993Ex2GnKQuqEoL2CQXoMRFha2t1kWzDhiq61M7qaX",
        "12D3KooWBzqb1AFLQJd4NooU7q6dSsYBFL85A8RPsJDLesfxHvbW",
        "12D3KooWHLCGig6Qr3K2z9QGJrYZqUGv2ZeXJufYSQR8bQbMqb4s",
      ]) {
        expect(parseSystemConnected(1, { ...payload, network_id: id })?.node.networkId).toBe(id);
      }
    });

    it("accepts a non-Ed25519 PeerId, which starts differently", () => {
      // Every Orbinum node uses an Ed25519 key today, so every id begins
      // `12D3KooW` — but anchoring on that would silently drop a node with an
      // RSA key, whose id is a `Qm…` multihash instead.
      const rsa = "QmYyQSo1c1Ym7orWxLYvCrM2EmxFTANf8wXmmE7DWjhx5N";
      expect(parseSystemConnected(1, { ...payload, network_id: rsa })).not.toBeNull();
    });

    it("rejects a long random string, the write amplifier this closes", () => {
      // Under a length-only bound this passed, and each distinct value would
      // become another node identity in any per-node table.
      expect(parseSystemConnected(1, { ...payload, network_id: "a".repeat(128) })).toBeNull();
    });

    it("rejects values outside the base58 alphabet", () => {
      // 0, O, I and l are excluded from base58 precisely because they are
      // easy to confuse — an id containing them did not come from libp2p.
      for (const id of ["0".repeat(52), "O".repeat(52), "I".repeat(52), "l".repeat(52)]) {
        expect(parseSystemConnected(1, { ...payload, network_id: id }), id).toBeNull();
      }
    });

    it("rejects ids that are too short or empty", () => {
      for (const id of ["", "12D3KooWTest", "abc"]) {
        expect(parseSystemConnected(1, { ...payload, network_id: id }), id).toBeNull();
      }
    });
  });

  it("fails when an optional field has the wrong type", () => {
    expect(parseSystemConnected(1, { ...payload, validator: 42 })).toBeNull();
    expect(parseSystemConnected(1, { ...payload, sysinfo: "not an object" })).toBeNull();
    expect(parseSystemConnected(1, { ...payload, sysinfo: { core_count: "16" } })).toBeNull();
  });

  it("ignores unknown fields", () => {
    expect(parseSystemConnected(1, { ...payload, wibble: "wobble", bar: 123 })).not.toBeNull();
  });

  it("splits the target triple out of old-style version strings", () => {
    const msg = parseSystemConnected(1, payload);
    expect(msg?.node.version).toBe("1.2.0-abcdef123");
    expect(msg?.node.targetArch).toBe("x86_64");
    expect(msg?.node.targetOs).toBe("linux");
    expect(msg?.node.targetEnv).toBe("gnu");
  });

  it("leaves the version alone when any explicit target is present", () => {
    const msg = parseSystemConnected(1, { ...payload, target_os: "linux" });
    expect(msg?.node.version).toBe("1.2.0-abcdef123-x86_64-linux-gnu");
    expect(msg?.node.targetArch).toBeUndefined();
  });

  it("accepts a genesis hash given as an array of 32 bytes", () => {
    const bytes = Array.from({ length: 32 }, (_, i) => i);
    const msg = parseSystemConnected(1, { ...payload, genesis_hash: bytes });
    expect(msg?.genesisHash).toBe(
      "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("drops the <unknown> validator placeholder but keeps the node", () => {
    const msg = parseSystemConnected(1, { ...payload, validator: "<unknown>", authority: true });
    expect(msg).not.toBeNull();
    expect(msg?.node.validator).toBeUndefined();
    expect(msg?.node.authority).toBe(true);
  });

  it("keeps a real validator address", () => {
    const msg = parseSystemConnected(1, { ...payload, validator: "5GrwvaEF" });
    expect(msg?.node.validator).toBe("5GrwvaEF");
  });
});
