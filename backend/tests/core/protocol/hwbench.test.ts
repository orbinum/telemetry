import { describe, expect, it } from "vitest";
import { parseHwBench } from "../../../src/core/protocol/hwbench";

describe("parseHwBench", () => {
  it("parses required scores with optional disk/parallel scores", () => {
    const msg = parseHwBench(1, {
      msg: "sysinfo.hwbench",
      cpu_hashrate_score: 1000,
      memory_memcpy_score: 2000,
      disk_sequential_write_score: 300,
    });
    expect(msg).toEqual({
      msg: "sysinfo.hwbench",
      id: 1,
      cpuHashrateScore: 1000,
      memoryMemcpyScore: 2000,
      diskSequentialWriteScore: 300,
      diskRandomWriteScore: undefined,
      parallelCpuHashrateScore: undefined,
    });
  });

  it("fails when a required score is missing or mistyped", () => {
    expect(parseHwBench(1, { msg: "sysinfo.hwbench", memory_memcpy_score: 2 })).toBeNull();
    expect(
      parseHwBench(1, { msg: "sysinfo.hwbench", cpu_hashrate_score: "1", memory_memcpy_score: 2 }),
    ).toBeNull();
  });

  it("fails when an optional score is mistyped", () => {
    expect(
      parseHwBench(1, {
        msg: "sysinfo.hwbench",
        cpu_hashrate_score: 1,
        memory_memcpy_score: 2,
        disk_random_write_score: "fast",
      }),
    ).toBeNull();
  });
});
