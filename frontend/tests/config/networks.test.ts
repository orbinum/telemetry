import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_NETWORKS,
  DEFAULT_NETWORK,
  NETWORKS,
  getNetwork,
  isNetworkAvailable,
  loadNetwork,
  saveNetwork,
  wsBase,
} from "../../src/config/networks";
import type { Network, NetworkId } from "../../src/config/networks";

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

  it("knows no devnet at all", () => {
    // The deployed worker rejects a --dev chain, whose genesis changes on
    // every restart. A developer runs their own worker and allowlists that
    // chain there instead of the UI carrying a tab for it.
    expect(ALL_NETWORKS.some((n) => n.id === ("devnet" as NetworkId))).toBe(false);
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

  it("knows both networks even when one is hidden", () => {
    expect(ALL_NETWORKS.map((n) => n.id)).toEqual(["testnet", "mainnet"]);
  });
});

describe("endpoints", () => {
  it("serves testnet and mainnet from the same deployed worker", () => {
    const testnet = ALL_NETWORKS.find((n) => n.id === "testnet")!;
    const mainnet = ALL_NETWORKS.find((n) => n.id === "mainnet")!;
    expect(testnet.apiBase).toBe(mainnet.apiBase);
  });

  it("points every network at the same worker, wherever it is", () => {
    // One deploy serves both chains; the chain is a filter, not a second
    // stack. VITE_API_BASE moves all of them together, at a developer's own
    // worker or a staging one.
    expect(new Set(ALL_NETWORKS.map((n) => n.apiBase)).size).toBe(1);
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
    const available = NETWORKS[0];
    if (available === undefined) return; // a build with nothing configured
    saveNetwork(available.id);
    expect(loadNetwork()).toBe(available.id);
  });

  it("ignores a stored network that is no longer available", () => {
    // e.g. mainnet was configured, then its genesis was removed. Falls back to
    // DEFAULT_NETWORK, which is an available one whenever the build has any.
    stubStorage({ "telemetry.network": "mainnet" });
    expect(loadNetwork()).toBe(DEFAULT_NETWORK);
    if (NETWORKS.length > 0) expect(NETWORKS.some((n) => n.id === loadNetwork())).toBe(true);
  });

  it("ignores a stored value that was never a network", () => {
    stubStorage({ "telemetry.network": "staging" });
    expect(loadNetwork()).toBe(DEFAULT_NETWORK);
    if (NETWORKS.length > 0) expect(NETWORKS.some((n) => n.id === loadNetwork())).toBe(true);
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
