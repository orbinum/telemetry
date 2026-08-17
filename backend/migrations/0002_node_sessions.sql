-- Node sessions: one row per continuous connection, not per interval.
--
-- This is what answers "which validator has the worst uptime" and "is this
-- node flapping" — questions the per-chain aggregates in 0001 cannot, because
-- they deliberately collapse per-node identity into histograms.
--
-- The volume is what makes it affordable: a stable 500-node network writes
-- ~500 rows a day, since a row is only produced when a node leaves. A row per
-- node per minute would be 720,000.
--
-- `network_id` is the node's libp2p PeerId. It is stable across restarts and
-- redeploys for any node with a fixed key, which is every Orbinum node
-- (node-deploy pins *_NODE_KEY in .env). It is also SELF-REPORTED on a public
-- endpoint and nothing proves the sender holds the matching private key — the
-- parser checks its shape, never its ownership. Read this table as "what nodes
-- claimed", which is fine for an operator dashboard and not fine as an input
-- to anything consequential.

CREATE TABLE node_sessions (
  network_id      TEXT    NOT NULL,
  genesis         TEXT    NOT NULL,
  connected_at    INTEGER NOT NULL,
  -- NULL while the node is still connected. Set when the connection closes or
  -- the 60s reaper sweeps it, which is also when uptime becomes computable.
  disconnected_at INTEGER,

  -- Reported at connect. Kept per session rather than in a node dimension
  -- table because they change between sessions — a version changing IS the
  -- upgrade, and losing the old value would erase when it happened.
  name            TEXT,
  version         TEXT,
  implementation  TEXT,
  is_authority    INTEGER NOT NULL DEFAULT 0,
  country         TEXT,
  -- The sysinfo blob (cpu, cores, memory, kernel, distro, VM). Parsed since
  -- day one and read by nothing until now.
  sysinfo         TEXT,

  -- A node cannot open two sessions in the same millisecond, so this is unique
  -- without a surrogate key — and the prefix (network_id, genesis) is the
  -- lookup every uptime query starts from.
  PRIMARY KEY (network_id, genesis, connected_at)
) WITHOUT ROWID;

-- "Which nodes were up during this window", across all nodes of a chain. The
-- primary key above is ordered by node first, so a time-ranged scan over a
-- whole chain would otherwise read every row of every node. This is the one
-- secondary index in the schema, and it earns its extra written row: without
-- it the chain-wide uptime query degrades to a full table scan, which D1 bills
-- by rows scanned.
CREATE INDEX idx_node_sessions_chain_time ON node_sessions (genesis, connected_at);
