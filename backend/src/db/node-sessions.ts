/**
 * Node sessions in D1 — one row per continuous connection.
 *
 * Keyed on the node's self-reported PeerId, which is stable across restarts
 * for any node with a fixed key but is not proof of anything: `/submit` is
 * public and nothing verifies ownership. This table records what nodes
 * claimed, which is what an operator dashboard needs and is not an input to
 * anything consequential.
 *
 * A session is opened on `system.connected` and closed when the node leaves,
 * so the write volume follows connection churn rather than message rate: a
 * stable 500-node network writes hundreds of rows a day, not hundreds of
 * thousands.
 */

import type { NodeState } from "../domain/node-state";
import type { NodeSession, NodeUptime } from "../ports/persistence";

export { SESSION_RETENTION_MS } from "../config/limits";

export type { NodeSession, NodeUptime } from "../ports/persistence";

interface SessionRow {
  network_id: string;
  genesis: string;
  connected_at: number;
  disconnected_at: number | null;
  name: string | null;
  version: string | null;
  implementation: string | null;
  is_authority: number;
  country: string | null;
  validator: string | null;
}

interface UptimeRow {
  network_id: string;
  name: string | null;
  version: string | null;
  is_authority: number;
  uptime_ms: number;
  sessions: number;
  last_seen: number;
}

function toSession(row: SessionRow): NodeSession {
  return {
    networkId: row.network_id,
    genesis: row.genesis,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at ?? undefined,
    name: row.name ?? undefined,
    version: row.version ?? undefined,
    implementation: row.implementation ?? undefined,
    isAuthority: row.is_authority === 1,
    country: row.country ?? undefined,
    validator: row.validator ?? undefined,
  };
}

/**
 * Open a session for a node that just announced itself.
 *
 * `INSERT OR IGNORE`: a node whose ChainDO was evicted has its cached
 * system.connected replayed, which would otherwise reopen a session that is
 * already recorded. The primary key makes the replay a no-op.
 */
export async function openSession(db: D1Database, genesis: string, node: NodeState): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO node_sessions (
         network_id, genesis, connected_at, name, version, implementation,
         is_authority, country, sysinfo, validator
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      node.details.networkId,
      genesis,
      node.connectedAt,
      node.details.name,
      node.details.version,
      node.details.implementation,
      node.details.authority === true ? 1 : 0,
      node.geo?.country ?? null,
      node.details.sysinfo === undefined ? null : JSON.stringify(node.details.sysinfo),
      node.validator ?? null,
    )
    .run();
}

/**
 * Record the address a node just announced, on the session that is still open.
 *
 * Called when `afg.authority_set` arrives, which is once per connection and
 * milliseconds after the session row is written — hence an UPDATE rather than
 * a column on the insert.
 */
export async function recordValidatorAddress(
  db: D1Database,
  genesis: string,
  networkId: string,
  connectedAt: number,
  address: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE node_sessions SET validator = ?1
       WHERE network_id = ?2 AND genesis = ?3 AND connected_at = ?4`,
    )
    .bind(address, networkId, genesis, connectedAt)
    .run();
}

/**
 * The last address this node was seen with, if any.
 *
 * The fallback for verbosity 0 and for evictions alike: at 0 the node never
 * sends afg at all, so without this the Address column stays empty forever
 * even though the address was recorded months ago.
 *
 * Ordered by session, so a node that changed its validator account reports the
 * newer one rather than whichever row the engine happened to reach first.
 */
export async function readLastValidatorAddress(
  db: D1Database,
  genesis: string,
  networkId: string,
): Promise<string | undefined> {
  const row = await db
    .prepare(
      `SELECT validator FROM node_sessions
       WHERE network_id = ?1 AND genesis = ?2 AND validator IS NOT NULL
       ORDER BY connected_at DESC LIMIT 1`,
    )
    .bind(networkId, genesis)
    .first<{ validator: string }>();
  return row?.validator ?? undefined;
}

/**
 * Close the sessions of nodes that left.
 *
 * One `db.batch()` for the whole departure rather than a statement per node:
 * D1 caps the queries a single invocation may issue, and a reaper sweeping a
 * large chain would otherwise issue one call per node — the failure mode
 * api-worker hit in production (`weekly-close.ts`), where grouping cut 12.6k
 * calls to ~160.
 *
 * Only sessions still open are touched, so a node closed by the reaper and
 * then by its socket keeps the earlier, truthful timestamp.
 */
export async function closeSessions(
  db: D1Database,
  genesis: string,
  departures: { networkId: string; connectedAt: number }[],
  now: number,
): Promise<void> {
  if (departures.length === 0) return;

  await db.batch(
    departures.map((d) =>
      db
        .prepare(
          `UPDATE node_sessions SET disconnected_at = ?1
           WHERE network_id = ?2 AND genesis = ?3 AND connected_at = ?4
             AND disconnected_at IS NULL`,
        )
        .bind(now, d.networkId, genesis, d.connectedAt),
    ),
  );
}

/**
 * Close sessions this chain left open, keeping one open session per node.
 *
 * A session is closed when its node leaves, but nothing runs when the object
 * holding it dies outright — an eviction, a redeploy, a crash. The row stays
 * open forever, and since `readUptime` treats an open session as still running
 * (`COALESCE(disconnected_at, now)`), a node that disconnected days ago keeps
 * accruing uptime it never had.
 *
 * Called on the first connect after a ChainDO starts, with the nodes it now
 * considers live. Everything else open for this chain is a leftover.
 *
 * Each leftover is closed at the moment its node next reconnected, never at
 * `now`: one node cannot hold two sessions at once, so the following
 * `connected_at` is the latest instant the old one can still have been alive.
 * A leftover with no later session has no such evidence and is closed at
 * `fallback` — the time this object started, the earliest moment it can prove
 * the session was already stale.
 */
export async function closeOrphanSessions(
  db: D1Database,
  genesis: string,
  liveConnectedAt: number[],
  fallback: number,
): Promise<number> {
  // `connected_at` is part of the primary key, so it identifies the live rows
  // on its own within one chain. Inlined rather than bound because D1 caps the
  // number of parameters, and this list grows with the chain.
  const keep =
    liveConnectedAt.length === 0
      ? ""
      : `AND s.connected_at NOT IN (${liveConnectedAt.map((at) => Number(at)).join(",")})`;

  const { meta } = await db
    .prepare(
      `UPDATE node_sessions AS s
          SET disconnected_at = COALESCE(
                (SELECT MIN(n.connected_at) FROM node_sessions n
                  WHERE n.network_id = s.network_id AND n.genesis = s.genesis
                    AND n.connected_at > s.connected_at),
                ?2)
        WHERE s.genesis = ?1
          AND s.disconnected_at IS NULL
          AND s.connected_at < ?2
          ${keep}`,
    )
    .bind(genesis, fallback)
    .run();

  return meta.changes ?? 0;
}

/**
 * Uptime per node over a window.
 *
 * A session that started before the window or has not ended yet is clamped to
 * the window, so "uptime in the last 24h" means time inside those 24 hours
 * rather than the age of the session.
 */
export async function readUptime(
  db: D1Database,
  genesis: string,
  from: number,
  now: number,
): Promise<NodeUptime[]> {
  const { results } = await db
    .prepare(
      `SELECT network_id,
              -- The newest session's metadata, since a node may have upgraded
              -- mid-window and the current version is the useful one.
              (SELECT name FROM node_sessions n2
                WHERE n2.network_id = s.network_id AND n2.genesis = s.genesis
                ORDER BY n2.connected_at DESC LIMIT 1) AS name,
              (SELECT version FROM node_sessions n2
                WHERE n2.network_id = s.network_id AND n2.genesis = s.genesis
                ORDER BY n2.connected_at DESC LIMIT 1) AS version,
              MAX(is_authority) AS is_authority,
              SUM(MIN(COALESCE(disconnected_at, ?3), ?3) - MAX(connected_at, ?2)) AS uptime_ms,
              COUNT(*) AS sessions,
              MAX(COALESCE(disconnected_at, ?3)) AS last_seen
       FROM node_sessions s
       WHERE genesis = ?1
         AND COALESCE(disconnected_at, ?3) >= ?2
       GROUP BY network_id
       ORDER BY uptime_ms DESC`,
    )
    .bind(genesis, from, now)
    .all<UptimeRow>();

  return results.map((row) => ({
    networkId: row.network_id,
    name: row.name ?? undefined,
    version: row.version ?? undefined,
    isAuthority: row.is_authority === 1,
    uptimeMs: Math.max(0, row.uptime_ms),
    sessions: row.sessions,
    lastSeen: row.last_seen,
  }));
}

/** Every session of one node, newest first — the flapping detail view. */
export async function readSessions(
  db: D1Database,
  genesis: string,
  networkId: string,
  from: number,
): Promise<NodeSession[]> {
  const { results } = await db
    .prepare(
      `SELECT network_id, genesis, connected_at, disconnected_at, name, version,
              implementation, is_authority, country, validator
       FROM node_sessions
       WHERE network_id = ?1 AND genesis = ?2 AND connected_at >= ?3
       ORDER BY connected_at DESC`,
    )
    .bind(networkId, genesis, from)
    .all<SessionRow>();

  return results.map(toSession);
}

/**
 * Drop old sessions, and the noise from nodes without a stable identity.
 *
 * A node with no persistent volume regenerates its key on every restart, so it
 * appears as a brand-new identity that connects once, briefly, and is never
 * seen again. Left in place those rows accumulate without ever answering
 * anything — one identity with one short session is not a history.
 */
export async function pruneSessions(
  db: D1Database,
  now: number,
  retentionMs: number,
  minSessionMs = 5 * 60 * 1000,
): Promise<void> {
  const cutoff = now - retentionMs;

  await db.batch([
    db.prepare(`DELETE FROM node_sessions WHERE connected_at < ?1`).bind(cutoff),
    db
      .prepare(
        `DELETE FROM node_sessions
         WHERE disconnected_at IS NOT NULL
           AND disconnected_at - connected_at < ?1
           AND network_id NOT IN (
             SELECT network_id FROM node_sessions
             GROUP BY network_id HAVING COUNT(*) > 1
           )`,
      )
      .bind(minSessionMs),
  ]);
}
