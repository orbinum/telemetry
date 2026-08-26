/**
 * `GET /chains` — the chain directory for the UI's picker.
 *
 * Each gateway partition keeps its own table of chains it has seen, so this
 * fans into all of them and merges, keeping the most recent label per genesis
 * hash. A partition that fails is skipped rather than failing the request:
 * a partial directory is far better than none.
 */

import type { Context } from "hono";
import type { AppEnv } from "../app-env";
import type { ChainDirectoryEntry } from "../../../shared/protocol/feed";
import type { ChainListing } from "../ports/directory";

export async function chains(c: Context<AppEnv>): Promise<Response> {
  const { registry } = c.get("deps");
  const partitions = await Promise.all(
    registry.gateways().map((gateway) =>
      gateway
        .fetch(new Request("https://do/chains"))
        .then((res) => res.json() as Promise<ChainListing[]>)
        .catch(() => [] as ChainListing[]),
    ),
  );

  const merged = new Map<string, ChainDirectoryEntry>();
  for (const row of partitions.flat()) {
    const existing = merged.get(row.genesis);
    if (existing === undefined || row.updated > existing.updatedAt) {
      merged.set(row.genesis, {
        genesisHash: row.genesis,
        label: row.label,
        updatedAt: row.updated,
      });
    }
  }

  return Response.json([...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt));
}
