import { beforeEach, describe, expect, it, vi } from "vitest";
import { lazyWithReload } from "../../src/presentation/router/lazyWithReload";

function stubEnv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  return { store, reload };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("lazyWithReload", () => {
  it("returns the module and leaves no reload marker behind", async () => {
    const { store } = stubEnv();
    const mod = { Component: "MapPage" };

    await expect(lazyWithReload(async () => mod)()).resolves.toBe(mod);
    expect(store.has("chunk-reload")).toBe(false);
  });

  it("reloads once on a failed chunk instead of surfacing the error", async () => {
    const { reload } = stubEnv();
    const load = lazyWithReload(async () => {
      throw new Error("Failed to load module script");
    });

    // Never settles: the reload replaces the page, so the caller must not
    // render a half-loaded route in the meantime.
    let settled = false;
    void load().then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();

    expect(reload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
  });

  it("rethrows when the failure survives the reload, so it cannot loop", async () => {
    const { reload } = stubEnv({ "chunk-reload": "1" });
    const error = new Error("Failed to load module script");

    await expect(
      lazyWithReload(async () => {
        throw error;
      })(),
    ).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the marker after a recovery, so a later deploy can reload again", async () => {
    const { store } = stubEnv({ "chunk-reload": "1" });

    await lazyWithReload(async () => ({ Component: "MapPage" }))();

    expect(store.has("chunk-reload")).toBe(false);
  });
});
