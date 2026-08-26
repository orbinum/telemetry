import { describe, expect, it } from "vitest";
import { FEED_VERSION, parseFeedMessage } from "../../../../shared/protocol/feed";
import type { FeedMessage, FeedNode } from "../../../../shared/protocol/feed";

const node: FeedNode = {
  id: 1,
  name: "validator-1",
  implementation: "Orbinum Node",
  version: "1.0.0",
  nodeType: "validator",
  stale: false,
  best: { hash: "0x" + "ab".repeat(32), height: 42 },
  propagationTime: 0,
};

describe("feed protocol round-trip", () => {
  it.each<[string, FeedMessage]>([
    [
      "init",
      {
        t: "init",
        v: FEED_VERSION,
        serverTime: 1_700_000_000_000,
        chain: { genesisHash: "0x" + "cd".repeat(32), label: "Orbinum Testnet", nodeCount: 1 },
        nodes: [node],
        done: true,
      },
    ],
    ["upd", { t: "upd", n: [node] }],
    ["rm", { t: "rm", n: [1, 2, 3] }],
    [
      "chain",
      {
        t: "chain",
        c: {
          genesisHash: "0x" + "cd".repeat(32),
          label: "Orbinum Testnet",
          nodeCount: 3,
          best: { hash: "0x" + "ef".repeat(32), height: 100 },
          averageBlockTime: 6000,
        },
      },
    ],
  ])("survives serialize → parse: %s", (_name, msg) => {
    expect(parseFeedMessage(JSON.stringify(msg))).toEqual(msg);
  });
});

describe("parseFeedMessage", () => {
  it("rejects garbage and unknown tags", () => {
    expect(parseFeedMessage("not json")).toBeNull();
    expect(parseFeedMessage("[1,2]")).toBeNull();
    expect(parseFeedMessage('{"t":"bogus"}')).toBeNull();
    expect(parseFeedMessage("{}")).toBeNull();
    expect(parseFeedMessage('{"t":42}')).toBeNull();
  });
});
