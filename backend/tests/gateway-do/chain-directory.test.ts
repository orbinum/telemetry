/**
 * Directory TTL tests.
 *
 * Without expiry the picker accumulates a dead tab for every chain the worker
 * ever saw — on a developer's machine that is one per throwaway devnet, each
 * looking as current as the chain they are actually working on.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { CHAIN_TTL_MS, ChainDirectory } from "../../src/gateway-do/chain-directory";
import type { ChainDirectoryRow } from "../../src/gateway-do/chain-directory";

const CHAIN_A = "0x" + "aa".repeat(32);
const CHAIN_B = "0x" + "bb".repeat(32);

/** In-memory stand-in for the DO's SqlStorage, covering the queries used here. */
function fakeSql(): SqlStorage {
  const rows = new Map<string, ChainDirectoryRow>();

  return {
    exec(query: string, ...bindings: unknown[]) {
      if (query.startsWith("CREATE TABLE")) {
        return { toArray: () => [] } as never;
      }
      if (query.startsWith("INSERT INTO chains")) {
        const [genesis, label, updated] = bindings as [string, string, number];
        rows.set(genesis, { genesis, label, updated });
        return { toArray: () => [] } as never;
      }
      if (query.startsWith("UPDATE chains SET updated")) {
        const [updated, genesis] = bindings as [number, string];
        const row = rows.get(genesis);
        if (row !== undefined) rows.set(genesis, { ...row, updated });
        return { toArray: () => [] } as never;
      }
      if (query.startsWith("DELETE FROM chains")) {
        const [cutoff] = bindings as [number];
        for (const [genesis, row] of rows) {
          if (row.updated < cutoff) rows.delete(genesis);
        }
        return { toArray: () => [] } as never;
      }
      if (query.startsWith("SELECT")) {
        const [cutoff] = bindings as [number];
        const listed = [...rows.values()]
          .filter((row) => row.updated >= cutoff)
          .sort((a, b) => b.updated - a.updated);
        return { toArray: () => listed } as never;
      }
      throw new Error(`unexpected query: ${query}`);
    },
  } as unknown as SqlStorage;
}

let directory: ChainDirectory;

beforeEach(() => {
  directory = new ChainDirectory(fakeSql());
});

describe("listing", () => {
  it("lists a chain that is currently reporting", () => {
    directory.record(CHAIN_A, "Development", 1000);
    expect(directory.list(1000).map((r) => r.label)).toEqual(["Development"]);
  });

  it("hides a chain that went quiet past the TTL", () => {
    // This is the reported symptom: a throwaway chain from an old test run
    // stayed in the picker forever.
    directory.record(CHAIN_A, "ScrollTest", 1000);
    expect(directory.list(1000 + CHAIN_TTL_MS)).toHaveLength(1); // exactly at the limit
    expect(directory.list(1000 + CHAIN_TTL_MS + 1)).toHaveLength(0);
  });

  it("keeps the active chain while dropping the stale one", () => {
    directory.record(CHAIN_A, "ScrollTest", 1000);
    directory.record(CHAIN_B, "Development", 1000);
    directory.touch(CHAIN_B, 1000 + CHAIN_TTL_MS);

    const listed = directory.list(1000 + CHAIN_TTL_MS + 1);
    expect(listed.map((r) => r.label)).toEqual(["Development"]);
  });

  it("orders by most recent activity", () => {
    directory.record(CHAIN_A, "Older", 1000);
    directory.record(CHAIN_B, "Newer", 2000);
    expect(directory.list(2000).map((r) => r.label)).toEqual(["Newer", "Older"]);
  });
});

describe("touch", () => {
  it("keeps a long-lived chain listed", () => {
    // A node that connected once and has streamed for hours must not age out.
    directory.record(CHAIN_A, "Development", 0);
    for (let t = 30_000; t <= 60 * 60_000; t += 30_000) {
      directory.touch(CHAIN_A, t);
    }
    expect(directory.list(60 * 60_000)).toHaveLength(1);
  });

  it("does nothing for a chain that was never recorded", () => {
    directory.touch(CHAIN_A, 1000);
    expect(directory.list(1000)).toHaveLength(0);
  });

  it("does not overwrite the label", () => {
    directory.record(CHAIN_A, "Development", 1000);
    directory.touch(CHAIN_A, 2000);
    expect(directory.list(2000)[0].label).toBe("Development");
  });
});

describe("prune", () => {
  it("deletes expired rows so the table stays bounded", () => {
    for (let i = 0; i < 50; i++) {
      directory.record("0x" + i.toString(16).padStart(64, "0"), `chain-${i}`, 1000);
    }
    directory.record(CHAIN_A, "Live", 1000 + CHAIN_TTL_MS);

    directory.prune(1000 + CHAIN_TTL_MS + 1);

    // Only the live one survives, and the deletion is real: a later list with
    // a wide-open window still sees just that row.
    expect(directory.list(1000 + CHAIN_TTL_MS + 1, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });

  it("keeps rows inside the window", () => {
    directory.record(CHAIN_A, "Development", 1000);
    directory.prune(1000 + CHAIN_TTL_MS);
    expect(directory.list(1000 + CHAIN_TTL_MS)).toHaveLength(1);
  });
});
