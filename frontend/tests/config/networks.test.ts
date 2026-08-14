import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_NETWORKS,
  NETWORKS,
  getNetwork,
  isNetworkAvailable,
  loadNetwork,
  saveNetwork,
  wsBase,
} from "../../src/config/networks";
import type { Network } from "../../src/config/networks";

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
}

function network(overrides: Partial<Network>): Network {
  return { id: "testnet", label: "Testnet", apiBase: "https://x", ...overrides };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("availability", () => {
  it("hides a fixed network until its genesis is configured", () => {
    // A tab with no genesis can only ever fail: the worker's allowlist
    // rejects chains it does not know.
    expect(isNetworkAvailable(network({ id: "testnet", genesisHash: undefined }))).toBe(false);
    expect(isNetworkAvailable(network({ id: "mainnet", genesisHash: undefined }))).toBe(false);
  });

  it("shows a fixed network once its genesis is configured", () => {
    expect(isNetworkAvailable(network({ genesisHash: "0x" + "ab".repeat(32) }))).toBe(true);
  });

  it("always offers devnet, whose chain is discovered at runtime", () => {
    // A --dev chain gets a fresh genesis on every restart, so it can never be
    // configured ahead of time.
    expect(isNetworkAvailable(network({ id: "devnet", genesisHash: undefined }))).toBe(true);
  });

  it("rejects a malformed genesis rather than offering a broken tab", () => {
    const bad = ALL_NETWORKS.find((n) => n.id === "testnet");
    // Whatever the build configured, it is either a valid hash or absent.
    if (bad?.genesisHash !== undefined) {
      expect(bad.genesisHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("only exposes available networks to the UI", () => {
    expect(NETWORKS.every(isNetworkAvailable)).toBe(true);
    expect(NETWORKS.length).toBeLessThanOrEqual(ALL_NETWORKS.length);
  });

  it("knows all three networks even when some are hidden", () => {
    expect(ALL_NETWORKS.map((n) => n.id)).toEqual(["testnet", "mainnet", "devnet"]);
  });
});

describe("endpoints", () => {
  it("serves testnet and mainnet from the same deployed worker", () => {
    const testnet = ALL_NETWORKS.find((n) => n.id === "testnet")!;
    const mainnet = ALL_NETWORKS.find((n) => n.id === "mainnet")!;
    expect(testnet.apiBase).toBe(mainnet.apiBase);
  });

  it("points devnet at a local worker, not at the deployed one", () => {
    const devnet = ALL_NETWORKS.find((n) => n.id === "devnet")!;
    const testnet = ALL_NETWORKS.find((n) => n.id === "testnet")!;
    expect(devnet.apiBase).not.toBe(testnet.apiBase);
    expect(devnet.apiBase).toMatch(/localhost/);
  });

  it("points devnet at the worker port, never at the node's RPC port", () => {
    // 9944 is JSON-RPC: it does not speak telemetry, and a single node has
    // none of the cross-node numbers this UI shows.
    expect(ALL_NETWORKS.find((n) => n.id === "devnet")!.apiBase).not.toMatch(/9944/);
  });

  it("explains how to feed devnet when it is empty", () => {
    expect(ALL_NETWORKS.find((n) => n.id === "devnet")!.emptyHint).toBeDefined();
  });

  it("derives the websocket base from the http one", () => {
    expect(wsBase(network({ apiBase: "http://localhost:8787" }))).toBe("ws://localhost:8787");
    expect(wsBase(network({ apiBase: "https://telemetry.orbinum.io" }))).toBe(
      "wss://telemetry.orbinum.io",
    );
  });

  it("returns undefined for a network that is not available", () => {
    const hidden = ALL_NETWORKS.find((n) => !isNetworkAvailable(n));
    if (hidden !== undefined) expect(getNetwork(hidden.id)).toBeUndefined();
    expect(getNetwork("bogus" as never)).toBeUndefined();
  });
});

describe("persistence", () => {
  it("round-trips an available network", () => {
    stubStorage();
    saveNetwork("devnet");
    expect(loadNetwork()).toBe("devnet");
  });

  it("ignores a stored network that is no longer available", () => {
    // e.g. mainnet was configured, then its genesis was removed.
    stubStorage({ "telemetry.network": "mainnet" });
    const loaded = loadNetwork();
    expect(NETWORKS.some((n) => n.id === loaded)).toBe(true);
  });

  it("ignores a stored value that was never a network", () => {
    stubStorage({ "telemetry.network": "staging" });
    expect(NETWORKS.some((n) => n.id === loadNetwork())).toBe(true);
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });
    expect(() => loadNetwork()).not.toThrow();
    expect(() => saveNetwork("devnet")).not.toThrow();
  });
});
