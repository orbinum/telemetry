/**
 * Chain directory fetch.
 *
 * The base URL is a parameter rather than a build-time constant: each network
 * is served by its own worker, and devnet's is on the developer's machine, so
 * which one to ask is only known at runtime.
 */

import type { ChainDirectoryEntry } from "../../../shared/protocol/feed";

export async function fetchChains(apiBase: string): Promise<ChainDirectoryEntry[]> {
  const res = await fetch(`${apiBase}/chains`);
  if (!res.ok) throw new Error(`chains: ${res.status}`);
  return (await res.json()) as ChainDirectoryEntry[];
}
