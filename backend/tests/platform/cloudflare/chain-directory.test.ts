/**
 * Directory TTL behaviour, run against every implementation of the port.
 *
 * Without expiry the picker accumulates a dead tab for every chain the worker
 * ever saw — on a developer's machine that is one per throwaway devnet, each
 * looking as current as the chain they are actually working on.
 *
 * The suite runs twice: once against the SQLite-backed adapter the worker
 * deploys, and once against a Map, which is what a single-process host would
 * use. Two implementations answering the same questions identically is the
 * only evidence that the port describes behaviour rather than one driver.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAIN_TTL_MS,
  SqlChainDirectory,
} from "../../../src/platform/cloudflare/sql-chain-directory";
import { sqliteStorage } from "../../support/sqlite-storage";
import type { ChainDirectoryStore, ChainListing } from "../../../src/app/ports/directory";

const CHAIN_A = "0x" + "aa".repeat(32);
const CHAIN_B = "0x" + "bb".repeat(32);

/**
 * The directory a single-process host would keep. Written here rather than
 * shipped: it exists to hold the port honest, not to be deployed.
 */
class MapChainDirectory implements ChainDirectoryStore {
  private readonly rows = new Map<string, ChainListing>();

  record(genesisHash: string, label: string, now: number): void {
    this.rows.set(genesisHash, { genesis: genesisHash, label, updated: now });
  }

  touch(genesisHash: string, now: number): void {
    const row = this.rows.get(genesisHash);
    if (row !== undefined) row.updated = now;
  }

  list(now: number, ttlMs: number = CHAIN_TTL_MS): ChainListing[] {
    return [...this.rows.values()]
      .filter((row) => row.updated >= now - ttlMs)
      .sort((a, b) => b.updated - a.updated);
  }

  prune(now: number, ttlMs: number = CHAIN_TTL_MS): void {
    for (const [genesis, row] of this.rows) {
      if (row.updated < now - ttlMs) this.rows.delete(genesis);
    }
  }
}

const implementations: Array<[string, () => ChainDirectoryStore]> = [
  ["SqlChainDirectory", () => new SqlChainDirectory(sqliteStorage())],
  ["MapChainDirectory", () => new MapChainDirectory()],
];

describe.each(implementations)("%s", (_name, build) => {
  let directory: ChainDirectoryStore;

  beforeEach(() => {
    directory = build();
  });

  describe("listing", () => {
    it("lists a chain that is currently reporting", () => {
      directory.record(CHAIN_A, "Development", 1000);
      expect(directory.list(1000).map((r) => r.label)).toEqual(["Development"]);
    });

    it("hides a chain that went quiet past the TTL", () => {
      // The reported symptom: a throwaway chain from an old test run stayed in
      // the picker forever.
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

  describe("record", () => {
    it("follows the newest node's label", () => {
      directory.record(CHAIN_A, "Old Name", 1000);
      directory.record(CHAIN_A, "New Name", 2000);

      const listed = directory.list(2000);
      expect(listed).toHaveLength(1);
      expect(listed[0].label).toBe("New Name");
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
    it("deletes expired rows so the store stays bounded", () => {
      for (let i = 0; i < 50; i++) {
        directory.record("0x" + i.toString(16).padStart(64, "0"), `chain-${i}`, 1000);
      }
      directory.record(CHAIN_A, "Live", 1000 + CHAIN_TTL_MS);

      directory.prune(1000 + CHAIN_TTL_MS + 1);

      // The deletion is real: a later list with a wide-open window still sees
      // just that row.
      expect(directory.list(1000 + CHAIN_TTL_MS + 1, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
    });

    it("keeps rows inside the window", () => {
      directory.record(CHAIN_A, "Development", 1000);
      directory.prune(1000 + CHAIN_TTL_MS);
      expect(directory.list(1000 + CHAIN_TTL_MS)).toHaveLength(1);
    });
  });
});
