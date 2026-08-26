/**
 * `HistoryRepository` over D1.
 *
 * D1 rather than the Durable Object's own SQLite because history is written by
 * an alarm and read by browsers: keeping it outside means a dashboard load
 * never wakes the object servicing live ingest.
 *
 * The statements themselves live in `./sql/chain-history`, where they are tested
 * against real SQLite. This class only binds them to a database, which is the
 * whole of what makes them Cloudflare-specific.
 */

import { pruneHistory, readHistory, readHourlyHistory, writeSnapshot } from "./sql/chain-history";
import type { ChainSnapshot } from "../../core/domain/chain-snapshot";
import type { ChainHistoryPoint, HistoryRepository } from "../../app/ports/persistence";

export class D1HistoryRepository implements HistoryRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  writeSnapshot(snapshot: ChainSnapshot): Promise<void> {
    return writeSnapshot(this.db, snapshot);
  }

  readHistory(genesisHash: string, from: number): Promise<ChainHistoryPoint[]> {
    return readHistory(this.db, genesisHash, from);
  }

  readHourlyHistory(genesisHash: string, from: number): Promise<ChainHistoryPoint[]> {
    return readHourlyHistory(this.db, genesisHash, from);
  }

  prune(now: number, retentionMs?: number): Promise<void> {
    return pruneHistory(this.db, now, retentionMs);
  }
}
