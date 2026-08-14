import { describe, expect, it } from "vitest";
import { isChainAllowed, parseAllowedChains } from "../../src/config/chains";

const TESTNET = "0x58e2de05e550e64bb73bb2aeb706431dae70dcd1b589d477033c6e3aef3680ae";
const MAINNET = "0x" + "22".repeat(32);
const OTHER = "0x" + "11".repeat(32);

describe("parseAllowedChains", () => {
  it("is empty when nothing is configured, which means accept-all (local dev)", () => {
    expect(parseAllowedChains({}).size).toBe(0);
    expect(
      parseAllowedChains({
        TELEMETRY_TESTNET_GENESIS: "",
        TELEMETRY_MAINNET_GENESIS: "",
        TELEMETRY_CHAINS: "  ",
      }).size,
    ).toBe(0);
  });

  it("takes the dedicated testnet and mainnet vars", () => {
    const allowed = parseAllowedChains({
      TELEMETRY_TESTNET_GENESIS: TESTNET,
      TELEMETRY_MAINNET_GENESIS: MAINNET,
    });
    expect(allowed).toEqual(new Set([TESTNET, MAINNET]));
  });

  it("works with only testnet set — mainnet is empty until launch", () => {
    const allowed = parseAllowedChains({
      TELEMETRY_TESTNET_GENESIS: TESTNET,
      TELEMETRY_MAINNET_GENESIS: "",
    });
    expect(allowed).toEqual(new Set([TESTNET]));
  });

  it("merges the comma-separated extras, normalizing case and spacing", () => {
    const allowed = parseAllowedChains({
      TELEMETRY_TESTNET_GENESIS: TESTNET.toUpperCase(),
      TELEMETRY_CHAINS: ` ${OTHER} , ${MAINNET}`,
    });
    expect(allowed).toEqual(new Set([TESTNET, OTHER, MAINNET]));
  });

  it("drops malformed entries instead of throwing", () => {
    // A typo must not take ingest down — valid hashes still get through.
    const allowed = parseAllowedChains({
      TELEMETRY_TESTNET_GENESIS: "not-a-hash",
      TELEMETRY_CHAINS: `${OTHER},0x1234`,
    });
    expect(allowed).toEqual(new Set([OTHER]));
  });
});

describe("isChainAllowed", () => {
  it("accepts listed chains, case-insensitively", () => {
    const allowed = new Set([TESTNET]);
    expect(isChainAllowed(allowed, TESTNET)).toBe(true);
    expect(isChainAllowed(allowed, TESTNET.toUpperCase())).toBe(true);
  });

  it("rejects everything else — a Polkadot node pointed at us is dropped", () => {
    expect(isChainAllowed(new Set([TESTNET]), OTHER)).toBe(false);
  });

  it("an empty allowlist accepts everything (local dev)", () => {
    expect(isChainAllowed(new Set(), OTHER)).toBe(true);
  });
});
