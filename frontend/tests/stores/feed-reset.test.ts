/**
 * Switching networks must leave nothing of the previous one behind.
 *
 * Before `resetFeed` existed, moving from a working network to an unreachable
 * one kept the old nodes on screen — labelled as the new network, still
 * reporting "live" — because the feed store was only ever overwritten by the
 * *next* successful connection, which never came.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectFeed, resetFeed, useFeedStore } from "../../src/stores/feedStore";
import { FEED_VERSION } from "../../../shared/protocol/feed";
import type { FeedMessage } from "../../../shared/protocol/feed";

class FakeSocket {
  static last: FakeSocket | undefined;
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onclose?: () => void;
  onerror?: () => void;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  close(): void {
    this.closed = true;
  }
  emit(msg: FeedMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

let frames: FrameRequestCallback[] = [];
const runFrame = () => {
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(0));
};

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  frames = [];
});

afterEach(() => {
  resetFeed();
  vi.unstubAllGlobals();
});

/** The three things the UI shows, read straight off the store. */
function readFeed() {
  const { order, chain, status } = useFeedStore.getState();
  return { rows: order.length, label: chain?.label, best: chain?.best?.height, status };
}

/** Connect to a devnet-like feed and fill it with one node. */
function populate(): FakeSocket {
  connectFeed("0xdevnet", "ws://localhost:8787");
  const socket = FakeSocket.last!;
  socket.onopen?.();
  socket.emit({
    t: "init",
    v: FEED_VERSION,
    serverTime: Date.now(),
    chain: {
      genesisHash: "0xdevnet",
      label: "Development",
      nodeCount: 1,
      best: { hash: "0xabc", height: 2639 },
    },
    nodes: [
      {
        id: 1,
        name: "dev-node",
        implementation: "Orbinum Node",
        version: "1.0.0",
        stale: false,
        best: { hash: "0xabc", height: 2639 },
      },
    ],
    done: true,
  });
  runFrame();
  return socket;
}

describe("resetFeed", () => {
  it("clears the rows, the chain header and the live status", () => {
    const socket = populate();
    expect(readFeed()).toMatchObject({ rows: 1, label: "Development", best: 2639, status: "live" });

    resetFeed();

    // This is the regression: none of the previous network's readings may
    // survive, and the status must not still claim "live".
    expect(readFeed()).toMatchObject({
      rows: 0,
      label: undefined,
      best: undefined,
      status: "connecting",
    });
    expect(socket.closed).toBe(true);
  });

  it("a frame arriving after reset cannot resurrect the old data", () => {
    const socket = populate();
    resetFeed();

    socket.emit({
      t: "init",
      v: FEED_VERSION,
      serverTime: Date.now(),
      chain: { genesisHash: "0xdevnet", label: "Development", nodeCount: 99 },
      nodes: [],
      done: true,
    });
    runFrame();

    expect(readFeed().label).toBeUndefined();
  });

  it("connecting to another network starts from an empty table", () => {
    populate();
    resetFeed();

    connectFeed("0xtestnet", "wss://telemetry.orbinum.io");
    expect(FakeSocket.last!.url).toBe("wss://telemetry.orbinum.io/feed/0xtestnet");
    // Nothing has arrived for the new network, so the table is empty rather
    // than showing the previous one's nodes.
    expect(readFeed()).toMatchObject({ rows: 0, label: undefined });
  });
});
