/**
 * Chain history in D1 — the only place that touches the history tables.
 *
 * D1 rather than the DO's own SQLite because history is written by an alarm and
 * read by browsers: keeping it outside the Durable Object means a dashboard
 * load never wakes the object that is servicing live ingest.
 *
 * Columns are snake_case and rows are mapped explicitly, matching the
 * convention in api-worker's `src/db/`. Every function takes the database as
 * its first parameter, so nothing here reaches for a global.
 */

import type { ChainSnapshot, Histogram } from "../domain/chain-snapshot";
import { RAW_RETENTION_MS } from "../config/limits";
import type { ChainHistoryPoint } from "../ports/persistence";

export { RAW_RETENTION_MS } from "../config/limits";

export type { ChainHistoryPoint } from "../ports/persistence";

/** Row shape of `chain_history`, straight from D1. */
interface ChainHistoryRow {
  bucket: number;
  node_count: number;
  authority_count: number;
  stale_count: number;
  best_height: number | null;
  finalized_height: number | null;
  finality_lag: number | null;
  avg_block_time_ms: number | null;
  versions: string;
}

/** A histogram column, or an empty one if it was ever written malformed. */
function parseHistogram(raw: string): Histogram {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Histogram;
  } catch {
    return {};
  }
}

function toPoint(row: ChainHistoryRow): ChainHistoryPoint {
  return {
    bucket: row.bucket,
    nodeCount: row.node_count,
    authorityCount: row.authority_count,
    staleCount: row.stale_count,
    bestHeight: row.best_height ?? undefined,
    finalizedHeight: row.finalized_height ?? undefined,
    finalityLag: row.finality_lag ?? undefined,
    averageBlockTimeMs: row.avg_block_time_ms ?? undefined,
    versions: parseHistogram(row.versions),
  };
}

/**
 * Write one minute of history.
 *
 * Upsert on (genesis, bucket): alarms can fire late or twice, and a bucketed
 * key turns that from a duplicated data point into a harmless overwrite.
 */
export async function writeSnapshot(db: D1Database, snapshot: ChainSnapshot): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chain_history (
         genesis, bucket, node_count, authority_count, stale_count,
         best_height, finalized_height, finality_lag, avg_block_time_ms,
         versions, implementations, countries
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(genesis, bucket) DO UPDATE SET
         node_count = excluded.node_count,
         authority_count = excluded.authority_count,
         stale_count = excluded.stale_count,
         best_height = excluded.best_height,
         finalized_height = excluded.finalized_height,
         finality_lag = excluded.finality_lag,
         avg_block_time_ms = excluded.avg_block_time_ms,
         versions = excluded.versions,
         implementations = excluded.implementations,
         countries = excluded.countries`,
    )
    .bind(
      snapshot.genesisHash,
      snapshot.bucket,
      snapshot.nodeCount,
      snapshot.authorityCount,
      snapshot.staleCount,
      snapshot.bestHeight ?? null,
      snapshot.finalizedHeight ?? null,
      snapshot.finalityLag ?? null,
      snapshot.averageBlockTimeMs ?? null,
      JSON.stringify(snapshot.versions),
      JSON.stringify(snapshot.implementations),
      JSON.stringify(snapshot.countries),
    )
    .run();
}

/** History for one chain since `from`, oldest first. Covered by the primary key. */
export async function readHistory(
  db: D1Database,
  genesisHash: string,
  from: number,
): Promise<ChainHistoryPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT bucket, node_count, authority_count, stale_count, best_height,
              finalized_height, finality_lag, avg_block_time_ms, versions
       FROM chain_history
       WHERE genesis = ?1 AND bucket >= ?2
       ORDER BY bucket`,
    )
    .bind(genesisHash, from)
    .all<ChainHistoryRow>();

  return results.map(toPoint);
}

/**
 * The same series for a wide window, at hourly resolution.
 *
 * Reads *both* tables rather than only the rollup. The rollup lags the raw
 * buckets by the whole retention window — an hour is only rolled up once it
 * falls out of `chain_history` — so a chain younger than that retention has an
 * empty `chain_history_hourly` and a rollup-only query answers "30 days" with
 * nothing at all, which reads as "this chain has no history" rather than "this
 * chain is three days old".
 *
 * The raw half is folded to the same hour buckets so both halves plot as one
 * series, and the union prefers the rollup where an hour exists in both, which
 * can happen briefly while a prune is in flight.
 */
export async function readHourlyHistory(
  db: D1Database,
  genesisHash: string,
  from: number,
): Promise<ChainHistoryPoint[]> {
  const { results } = await db
    .prepare(
      `WITH rolled AS (
         SELECT bucket, node_count_max AS node_count,
                CAST(authority_count_avg AS INTEGER) AS authority_count,
                stale_count_max AS stale_count, best_height, finalized_height,
                finality_lag_max AS finality_lag, avg_block_time_ms, versions
         FROM chain_history_hourly
         WHERE genesis = ?1 AND bucket >= ?2
       ),
       raw AS (
         -- Aggregated exactly as pruneHistory would, so a point does not shift
         -- the day its hour is finally rolled up.
         SELECT bucket / 3600000 * 3600000 AS bucket,
                MAX(node_count) AS node_count,
                CAST(AVG(authority_count) AS INTEGER) AS authority_count,
                MAX(stale_count) AS stale_count,
                MAX(best_height) AS best_height,
                MAX(finalized_height) AS finalized_height,
                MAX(finality_lag) AS finality_lag,
                AVG(avg_block_time_ms) AS avg_block_time_ms,
                (SELECT versions FROM chain_history newest
                  WHERE newest.genesis = outer_h.genesis
                    AND newest.bucket / 3600000 = outer_h.bucket / 3600000
                  ORDER BY newest.bucket DESC LIMIT 1) AS versions
         FROM chain_history outer_h
         WHERE genesis = ?1 AND bucket >= ?2
         GROUP BY bucket / 3600000
       )
       SELECT * FROM rolled
       UNION ALL
       SELECT * FROM raw WHERE bucket NOT IN (SELECT bucket FROM rolled)
       ORDER BY bucket`,
    )
    .bind(genesisHash, from)
    .all<ChainHistoryRow>();

  return results.map(toPoint);
}

/**
 * Roll finished hours up and drop the raw buckets behind the retention window.
 *
 * Both statements go in one `db.batch()`: it is a single round trip and a
 * transaction, so a rollup can never be committed without its prune, or the
 * reverse. Run from the cron trigger, never from a DO alarm — this is
 * chain-independent maintenance and has no business waking a hot object.
 */
export async function pruneHistory(
  db: D1Database,
  now: number,
  retentionMs: number = RAW_RETENTION_MS,
): Promise<void> {
  const cutoff = now - retentionMs;

  await db.batch([
    db
      .prepare(
        `INSERT INTO chain_history_hourly (
           genesis, bucket, node_count_min, node_count_max, node_count_avg,
           authority_count_avg, stale_count_max, best_height, finalized_height,
           finality_lag_max, avg_block_time_ms, versions
         )
         SELECT genesis,
                bucket / 3600000 * 3600000 AS hour,
                MIN(node_count), MAX(node_count), AVG(node_count),
                AVG(authority_count), MAX(stale_count),
                MAX(best_height), MAX(finalized_height),
                MAX(finality_lag), AVG(avg_block_time_ms),
                -- The histogram at the end of the hour: a point sample answers
                -- "what was deployed then", and merging JSON in SQL is not
                -- worth what it would cost to read.
                (SELECT versions FROM chain_history inner_h
                  WHERE inner_h.genesis = chain_history.genesis
                    AND inner_h.bucket / 3600000 = chain_history.bucket / 3600000
                  ORDER BY inner_h.bucket DESC LIMIT 1)
         FROM chain_history
         WHERE bucket < ?1
         GROUP BY genesis, hour
         ON CONFLICT(genesis, bucket) DO NOTHING`,
      )
      .bind(cutoff),
    db.prepare(`DELETE FROM chain_history WHERE bucket < ?1`).bind(cutoff),
  ]);
}
