/**
 * Parser for `sysinfo.hwbench` — cpu_hashrate_score and memory_memcpy_score
 * are required; the disk/parallel scores are optional.
 */

import { INVALID, optNumber } from "./fields";
import { isValidCount } from "./limits";
import type { HwBenchMessage } from "./types";

export function parseHwBench(id: number, p: Record<string, unknown>): HwBenchMessage | null {
  const cpu = p.cpu_hashrate_score;
  const mem = p.memory_memcpy_score;
  if (typeof cpu !== "number" || !isValidCount(cpu)) return null;
  if (typeof mem !== "number" || !isValidCount(mem)) return null;

  const diskSequentialWriteScore = optNumber(p.disk_sequential_write_score);
  const diskRandomWriteScore = optNumber(p.disk_random_write_score);
  const parallelCpuHashrateScore = optNumber(p.parallel_cpu_hashrate_score);
  for (const f of [diskSequentialWriteScore, diskRandomWriteScore, parallelCpuHashrateScore]) {
    if (f === INVALID) return null;
    if (typeof f === "number" && !isValidCount(f)) return null;
  }

  return {
    msg: "sysinfo.hwbench",
    id,
    cpuHashrateScore: cpu,
    memoryMemcpyScore: mem,
    diskSequentialWriteScore: diskSequentialWriteScore as number | undefined,
    diskRandomWriteScore: diskRandomWriteScore as number | undefined,
    parallelCpuHashrateScore: parallelCpuHashrateScore as number | undefined,
  };
}
