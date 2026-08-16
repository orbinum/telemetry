/**
 * Chain directory fetch.
 *
 * The base URL is a parameter rather than a build-time constant: the worker a
 * network is served from moves with the build (a developer's own, a staging
 * one), so which to ask is only known at runtime.
 */

import type { ChainDirectoryEntry } from "../../../shared/protocol/feed";

export async function fetchChains(apiBase: string): Promise<ChainDirectoryEntry[]> {
  const res = await fetch(`${apiBase}/chains`);
  if (!res.ok) throw new Error(`chains: ${res.status}`);
  return (await res.json()) as ChainDirectoryEntry[];
}
