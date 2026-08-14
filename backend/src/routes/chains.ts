/**
 * `GET /chains` — the chain directory for the UI's picker.
 *
 * Each gateway partition keeps its own table of chains it has seen, so this
 * fans into all of them and merges, keeping the most recent label per genesis
 * hash. A partition that fails is skipped rather than failing the request:
 * a partial directory is far better than none.
 */

import type { Context } from "hono";
import { GATEWAY_PARTITIONS, gatewayPartitionStub } from "../services/do-registry";
import type { ChainDirectoryEntry } from "../../../shared/protocol/feed";
import type { ChainDirectoryRow } from "../gateway-do/chain-directory";

export async function chains(c: Context<{ Bindings: CloudflareBindings }>): Promise<Response> {
  const partitions = await Promise.all(
    Array.from({ length: GATEWAY_PARTITIONS }, (_, i) =>
      gatewayPartitionStub(c.env, i)
        .fetch(new Request("https://do/chains"))
        .then((res) => res.json<ChainDirectoryRow[]>())
        .catch(() => [] as ChainDirectoryRow[]),
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
