-- Chain history: one aggregated row per chain per 60s bucket.
--
-- Live node state is deliberately NOT stored — it rebuilds itself from the wire
-- in seconds, so persisting it would only create a second, always-stale source
-- of truth. What no restart can rebuild is time: how many nodes were online at
-- 3am, when finality stalled, whether a release actually rolled out.
--
-- The aggregation happens in ChainState before the write, which is what makes
-- the cost independent of node count: 5 nodes and 500 nodes both produce one
-- row per minute. A row per node would be ~65x the write volume for data the
-- histograms below already answer.

CREATE TABLE chain_history (
  genesis           TEXT    NOT NULL,
  -- Unix ms floored to the minute. This is what makes the write idempotent: an
  -- alarm that fires twice in the same minute overwrites its row instead of
  -- doubling the series.
  bucket            INTEGER NOT NULL,

  node_count        INTEGER NOT NULL,
  authority_count   INTEGER NOT NULL,
  stale_count       INTEGER NOT NULL,

  best_height       INTEGER,
  finalized_height  INTEGER,
  -- Derivable from the two columns above, stored anyway: block production
  -- continuing while finality stalls is Substrate's classic failure mode, and
  -- it is the query this table exists to answer.
  finality_lag      INTEGER,
  avg_block_time_ms REAL,

  -- Per-node cardinality collapsed into one row: {"0.2.5":11,"0.2.4":3}
  -- answers "did the upgrade roll out?" without storing a row per node.
  versions          TEXT    NOT NULL DEFAULT '{}',
  implementations   TEXT    NOT NULL DEFAULT '{}',
  countries         TEXT    NOT NULL DEFAULT '{}',

  -- No secondary indexes anywhere in this schema: D1 bills a second written row
  -- per index, and this key is both the storage order and the order every read
  -- wants (WHERE genesis = ? AND bucket >= ? ORDER BY bucket).
  PRIMARY KEY (genesis, bucket)
) WITHOUT ROWID;

-- Hourly rollups, kept indefinitely while the 60s buckets above expire after 30
-- days. 8,760 rows per chain per year — small enough that retention is a
-- non-issue, coarse enough that a month-wide chart reads 720 rows instead of
-- 43,200.
CREATE TABLE chain_history_hourly (
  genesis               TEXT    NOT NULL,
  bucket                INTEGER NOT NULL,   -- unix ms floored to the hour

  node_count_min        INTEGER NOT NULL,
  node_count_max        INTEGER NOT NULL,
  node_count_avg        REAL    NOT NULL,
  authority_count_avg   REAL    NOT NULL,
  stale_count_max       INTEGER NOT NULL,

  best_height           INTEGER,
  finalized_height      INTEGER,
  finality_lag_max      INTEGER,
  avg_block_time_ms     REAL,

  -- The histogram as it stood at the end of the hour, not a merge: a point
  -- sample answers "what was deployed then" and merging JSON in SQL is not
  -- worth the complexity.
  versions              TEXT    NOT NULL DEFAULT '{}',

  PRIMARY KEY (genesis, bucket)
) WITHOUT ROWID;
