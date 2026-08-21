/**
 * FeedClient tests — the buffering/rAF logic is what keeps 500 rows
 * renderable, so it gets a test with a fake socket and a fake frame clock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_VERSION } from "../../../shared/protocol/feed";
import { FeedClient } from "../../src/services/feed-client";
import type { FeedSnapshot } from "../../src/services/feed-client";
import type { FeedChain, FeedMessage, FeedNode } from "../../../shared/protocol/feed";

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
  readyState = 1;
  sent: string[] = [];
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  send(data: string): void {
    this.sent.push(data);
  }
  emit(msg: FeedMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** A well-formed init frame; individual tests override what they care about. */
function init(
  chain: FeedChain,
  nodes: FeedNode[],
  done: boolean,
  overrides: Partial<FeedMessage & { v: number; serverTime: number }> = {},
): FeedMessage {
  return {
    t: "init",
    v: FEED_VERSION,
    serverTime: Date.now(),
    chain,
    nodes,
    done,
    ...overrides,
  } as FeedMessage;
}

/** Manually driven requestAnimationFrame so flushes are deterministic. */
let frameCallbacks: FrameRequestCallback[] = [];
function runFrame(): void {
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  callbacks.forEach((cb) => cb(0));
}

function node(id: number, height: number): FeedNode {
  return {
    id,
    name: `node-${id}`,
    implementation: "Orbinum Node",
    version: "1.0.0",
    stale: false,
    best: { hash: "0x" + id.toString(16).padStart(64, "0"), height },
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  frameCallbacks = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeedClient", () => {
  it("connects to the worker it was given, so networks stay separate", () => {
    // The base is per-network at runtime (devnet points at a local worker),
    // not baked in at build time.
    new FeedClient("0xdead", "ws://localhost:8787").connect();
    expect(FakeSocket.last!.url).toBe("ws://localhost:8787/feed/0xdead");

    new FeedClient("0xbeef", "wss://telemetry.orbinum.io").connect();
    expect(FakeSocket.last!.url).toBe("wss://telemetry.orbinum.io/feed/0xbeef");
  });

  it("coalesces a burst of messages into a single flush", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    const snapshots: number[] = [];
    client.subscribe((s) => snapshots.push(s.nodes.size));
    client.connect();

    const socket = FakeSocket.last!;
    socket.onopen?.();
    for (let i = 1; i <= 50; i++) socket.emit({ t: "upd", n: [node(i, i)] });

    // Nothing published until the frame runs — this is the whole point.
    expect(snapshots).toHaveLength(0);
    runFrame();
    expect(snapshots).toEqual([50]);
  });

  it("applies init, upsert and removal in order", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    let last: Map<number, FeedNode> = new Map();
    client.subscribe((s) => (last = s.nodes));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    socket.emit(
      init({ genesisHash: "0xabc", label: "Test", nodeCount: 2 }, [node(1, 10), node(2, 11)], true),
    );
    runFrame();
    expect([...last.keys()].sort()).toEqual([1, 2]);

    // Unknown id in an update is an insert.
    socket.emit({ t: "upd", n: [node(3, 12)] });
    runFrame();
    expect(last.size).toBe(3);

    socket.emit({ t: "rm", n: [1, 2] });
    runFrame();
    expect([...last.keys()]).toEqual([3]);
  });

  it("accumulates chunked init snapshots, then replaces on re-init", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    let last: Map<number, FeedNode> = new Map();
    client.subscribe((s) => (last = s.nodes));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    const chain = { genesisHash: "0xabc", label: "Test", nodeCount: 3 };
    socket.emit(init(chain, [node(1, 1), node(2, 2)], false));
    socket.emit(init(chain, [node(3, 3)], true));
    runFrame();
    expect(last.size).toBe(3);

    // A reconnect's init replaces the world instead of merging into it.
    socket.emit(init(chain, [node(9, 9)], true));
    runFrame();
    expect([...last.keys()]).toEqual([9]);
  });

  it("reports status transitions", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    const statuses: string[] = [];
    client.subscribe((s) => statuses.push(s.status));
    client.connect();

    FakeSocket.last!.onopen?.();
    runFrame();
    expect(statuses.at(-1)).toBe("live");
  });

  it("stops publishing after disconnect", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    let calls = 0;
    client.subscribe(() => calls++);
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();
    runFrame();
    const before = calls;

    client.disconnect();
    expect(socket.closed).toBe(true);
    socket.emit({ t: "upd", n: [node(1, 1)] });
    runFrame();
    expect(calls).toBe(before);
  });

  it("rejects a feed whose version this build does not understand", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    const statuses: string[] = [];
    let last: Map<number, FeedNode> = new Map();
    client.subscribe((s) => {
      statuses.push(s.status);
      last = s.nodes;
    });
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    socket.emit(
      init({ genesisHash: "0xabc", label: "Test", nodeCount: 1 }, [node(1, 1)], true, {
        v: FEED_VERSION + 1,
      }),
    );
    runFrame();

    // Not applied: these nodes may be shaped in a way this build misreads.
    expect(last.size).toBe(0);
    expect(statuses.at(-1)).toBe("outdated");
    expect(socket.closed).toBe(true);
  });

  it("does not reconnect once outdated", () => {
    vi.useFakeTimers();
    const client = new FeedClient("0xabc", "ws://test.local");
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();
    socket.emit(
      init({ genesisHash: "0xabc", label: "Test", nodeCount: 0 }, [], true, {
        v: FEED_VERSION + 1,
      }),
    );

    // Well past the reconnect delay: a mismatched build would loop forever.
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.last).toBe(socket);
    vi.useRealTimers();
  });

  it("measures the server clock offset from the init frame", () => {
    // Only the clock is faked; requestAnimationFrame stays the manual stub
    // this file drives, so `runFrame` still publishes.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const client = new FeedClient("0xabc", "ws://test.local");
    let offset = Number.NaN;
    client.subscribe((s) => (offset = s.clockOffset));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    // Server clock runs 30s ahead of this browser's.
    socket.emit(
      init({ genesisHash: "0xabc", label: "Test", nodeCount: 0 }, [], true, {
        serverTime: Date.now() + 30_000,
      }),
    );
    runFrame();

    expect(offset).toBe(30_000);
    vi.useRealTimers();
  });

  it("pings on an interval and tears down a socket that stops answering", () => {
    vi.useFakeTimers();
    const client = new FeedClient("0xabc", "ws://test.local");
    const statuses: string[] = [];
    client.subscribe((s) => statuses.push(s.status));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    vi.advanceTimersByTime(30_000);
    expect(socket.sent).toEqual(["ping"]);

    // Answered: the connection stays up.
    socket.onmessage?.({ data: "pong" });
    vi.advanceTimersByTime(30_000);
    expect(socket.sent).toEqual(["ping", "ping"]);
    expect(socket.closed).toBe(false);

    // Half-open past the timeout: closed by hand, since onclose never fires.
    vi.advanceTimersByTime(90_000);
    expect(socket.closed).toBe(true);
    vi.useRealTimers();
  });

  it("ignores a pong instead of treating it as a malformed frame", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    const snapshots: number[] = [];
    client.subscribe((s) => snapshots.push(s.nodes.size));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    // Drain the frame the "live" status queued, so the count is the pong's.
    runFrame();
    const before = snapshots.length;
    socket.onmessage?.({ data: "pong" });
    runFrame();
    // A pong is transport, not data: it must not publish a snapshot.
    expect(snapshots).toHaveLength(before);
  });

  it("merges deltas instead of replacing, so immutable fields survive", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    let last: Map<number, FeedNode> = new Map();
    client.subscribe((s) => (last = s.nodes));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    // The snapshot introduces the node with the fields that only ship once.
    socket.emit(
      init(
        { genesisHash: "0xabc", label: "Test", nodeCount: 1 },
        [{ ...node(1, 10), targetOs: "linux", sysinfo: { cpu: "Ryzen", coreCount: 16 } }],
        true,
      ),
    );
    runFrame();
    expect(last.get(1)?.sysinfo?.coreCount).toBe(16);

    // A later delta carries only what changed. Replacing the row wholesale
    // would silently blank the hardware columns.
    socket.emit({ t: "upd", n: [{ ...node(1, 11) }] });
    runFrame();
    expect(last.get(1)?.best?.height).toBe(11);
    expect(last.get(1)?.sysinfo?.coreCount).toBe(16);
    expect(last.get(1)?.targetOs).toBe("linux");
  });

  it("keeps chart series apart from the node rows", () => {
    const client = new FeedClient("0xabc", "ws://test.local");
    let snapshot: FeedSnapshot | undefined;
    client.subscribe((s) => (snapshot = s));
    client.connect();
    const socket = FakeSocket.last!;
    socket.onopen?.();

    socket.emit({
      t: "series",
      n: [{ id: 1, upload: [10, 20], download: [5], usedStateCacheSize: [1], chartStamps: [99] }],
    });
    runFrame();
    expect(snapshot?.series.get(1)?.upload).toEqual([10, 20]);

    // A removed node takes its series with it.
    socket.emit({ t: "rm", n: [1] });
    runFrame();
    expect(snapshot?.series.get(1)).toBeUndefined();
  });
});
