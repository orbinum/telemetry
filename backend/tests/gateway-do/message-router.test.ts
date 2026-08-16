/**
 * Ingest policy tests. Before the split these rules could only be exercised
 * through a real WebSocket; now they are a plain unit test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../../src/gateway-do/message-router";
import { RouteTable } from "../../src/gateway-do/route-table";
import { MAX_NODES_PER_CONNECTION } from "../../src/config/limits";
import type { ChainDirectory } from "../../src/gateway-do/chain-directory";
import type { NodeConnection } from "../../src/gateway-do/connection";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const ALLOWED = "0x" + "aa".repeat(32);
const FOREIGN = "0x" + "bb".repeat(32);

function connected(id: number, genesisHash = ALLOWED): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash,
    node: {
      chain: "Orbinum Testnet",
      name: `node-${id}`,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: `12D3KooW${id}`,
    },
  };
}

/** Minimal NodeConnection stand-in: only what the router touches. */
function fakeConnection(id = "1") {
  const cache = new Map<number, SystemConnectedMessage>();
  return {
    id,
    geo: undefined,
    nodeKey: (messageId: number) => `${id}:${messageId}`,
    nodeKeyPrefix: `${id}:`,
    isClosed: false,
    close: vi.fn(),
    rememberConnected: (msg: SystemConnectedMessage) => cache.set(msg.id, msg),
    recallConnected: (messageId: number) => cache.get(messageId),
  } as unknown as NodeConnection & { close: ReturnType<typeof vi.fn> };
}

let nodeConnected: ReturnType<typeof vi.fn>;
let nodeMessage: ReturnType<typeof vi.fn>;
let record: ReturnType<typeof vi.fn>;
let routes: RouteTable;

function makeRouter(allowed: Set<string> = new Set([ALLOWED])) {
  nodeConnected = vi.fn(async () => {});
  nodeMessage = vi.fn(async () => true);
  record = vi.fn();
  routes = new RouteTable();

  return new MessageRouter({
    routes,
    directory: { record, list: () => [] } as unknown as ChainDirectory,
    allowedChains: allowed,
    chainStub: () => ({ nodeConnected, nodeMessage }) as never,
    now: () => 1000,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("system.connected", () => {
  it("registers the route, records the chain and forwards to the ChainDO", async () => {
    const router = makeRouter();
    const conn = fakeConnection();

    await router.route(conn, connected(1));

    expect(routes.resolve("1", 1)).toBe(ALLOWED);
    expect(record).toHaveBeenCalledWith(ALLOWED, "Orbinum Testnet", 1000);
    expect(nodeConnected).toHaveBeenCalledWith("1:1", expect.anything(), undefined);
  });

  it("closes the connection when the chain is not allowed", async () => {
    const router = makeRouter();
    const conn = fakeConnection();

    await router.route(conn, connected(1, FOREIGN));

    expect(conn.close).toHaveBeenCalledWith(expect.any(Number), "chain not allowed");
    expect(nodeConnected).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects every chain when the allowlist is empty", async () => {
    // Fail-closed: missing or mistyped vars serve nobody rather than opening
    // ingest to every chain on the internet. Nothing is allocated either.
    const router = makeRouter(new Set());
    const conn = fakeConnection();

    await router.route(conn, connected(1, FOREIGN));

    expect(conn.close).toHaveBeenCalledWith(expect.any(Number), "chain not allowed");
    expect(nodeConnected).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("closes the connection past the node cap", async () => {
    const router = makeRouter();
    const conn = fakeConnection();

    for (let id = 1; id <= MAX_NODES_PER_CONNECTION; id++) {
      await router.route(conn, connected(id));
    }
    expect(conn.close).not.toHaveBeenCalled();

    await router.route(conn, connected(MAX_NODES_PER_CONNECTION + 1));
    expect(conn.close).toHaveBeenCalledWith(expect.any(Number), "too many nodes on one connection");
  });

  it("lets a known node re-announce even at the cap", async () => {
    const router = makeRouter();
    const conn = fakeConnection();
    for (let id = 1; id <= MAX_NODES_PER_CONNECTION; id++) {
      await router.route(conn, connected(id));
    }

    // Re-announcing id 1 claims no new slot.
    await router.route(conn, connected(1));
    expect(conn.close).not.toHaveBeenCalled();
  });
});

describe("other messages", () => {
  const interval = { msg: "system.interval", id: 1, peers: 4 } as const;

  it("routes to the chain the node announced", async () => {
    const router = makeRouter();
    const conn = fakeConnection();
    await router.route(conn, connected(1));

    await router.route(conn, interval);

    expect(nodeMessage).toHaveBeenCalledWith("1:1", interval);
  });

  it("drops messages that arrive before system.connected", async () => {
    const router = makeRouter();
    await router.route(fakeConnection(), interval);
    expect(nodeMessage).not.toHaveBeenCalled();
  });

  it("replays the cached connected when the ChainDO was evicted", async () => {
    const router = makeRouter();
    const conn = fakeConnection();
    await router.route(conn, connected(1));
    nodeConnected.mockClear();

    // The DO reports it has never heard of this node.
    nodeMessage.mockResolvedValueOnce(false);
    await router.route(conn, interval);

    expect(nodeConnected).toHaveBeenCalledTimes(1); // the replay
    expect(nodeMessage).toHaveBeenCalledTimes(2); // failed, then retried
  });
});
