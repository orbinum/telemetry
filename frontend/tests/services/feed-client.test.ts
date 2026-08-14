/**
 * FeedClient tests — the buffering/rAF logic is what keeps 500 rows
 * renderable, so it gets a test with a fake socket and a fake frame clock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedClient } from "../../src/services/feed-client";
import type { FeedMessage, FeedNode } from "../../../shared/protocol/feed";

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

    socket.emit({
      t: "init",
      chain: { genesisHash: "0xabc", label: "Test", nodeCount: 2 },
      nodes: [node(1, 10), node(2, 11)],
      done: true,
    });
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
    socket.emit({ t: "init", chain, nodes: [node(1, 1), node(2, 2)], done: false });
    socket.emit({ t: "init", chain, nodes: [node(3, 3)], done: true });
    runFrame();
    expect(last.size).toBe(3);

    // A reconnect's init replaces the world instead of merging into it.
    socket.emit({ t: "init", chain, nodes: [node(9, 9)], done: true });
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
});
