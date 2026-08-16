import { describe, expect, it } from "vitest";
import { parseSystemConnected } from "../../src/protocol/connected";

const GENESIS = "0x" + "ab".repeat(32);

const payload = {
  msg: "system.connected",
  genesis_hash: GENESIS,
  chain: "Orbinum Testnet",
  name: "validator-1",
  implementation: "Orbinum Node",
  version: "1.2.0-abcdef123-x86_64-linux-gnu",
  network_id: "12D3KooWTest",
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
});
