/**
 * Eviction tests for the gateway's per-socket state.
 *
 * The gateway hibernates, so a node socket outlives the object holding its
 * state. Everything NodeConnection owns has to round-trip through the socket
 * attachment — the byte budget above all, since a client that could drop the
 * object at will would otherwise reset its own rate limit for free.
 *
 * A fake socket stands in for the runtime: attachments are structured-clone in
 * production, so JSON round-tripping here is if anything the stricter check.
 */

import { describe, expect, it } from "vitest";
import { NodeConnection } from "../../src/gateway-do/connection";
import { BYTE_BUDGET_BYTES } from "../../src/config/limits";
import { peerId } from "../fixtures/peer-id";
import type { SystemConnectedMessage } from "../../src/protocol/node";

const GENESIS = "0x" + "aa".repeat(32);

/** Minimal stand-in for a hibernatable WebSocket. */
function fakeSocket() {
  let attachment: unknown = null;
  return {
    serializeAttachment: (value: unknown) => {
      // Mirrors the runtime's serialization boundary: a value that cannot
      // cross it must fail here rather than silently in production.
      attachment = JSON.parse(JSON.stringify(value)) as unknown;
    },
    deserializeAttachment: () => attachment,
    close: () => {},
  } as unknown as WebSocket;
}

function connected(id: number): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name: `node-${id}`,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(id),
    },
  };
}

/** Simulate an eviction: only the socket survives. */
function evict(socket: WebSocket): NodeConnection {
  const revived = NodeConnection.fromSocket(socket);
  if (revived === undefined) throw new Error("connection did not survive eviction");
  return revived;
}

describe("NodeConnection across an eviction", () => {
  it("restores identity and geo", () => {
    const socket = fakeSocket();
    const conn = new NodeConnection("do-7", socket, {
      city: "Santiago",
      country: "CL",
      latitude: -33.45,
      longitude: -70.66,
    });
    conn.persist();

    const revived = evict(socket);
    expect(revived.id).toBe("do-7");
    expect(revived.nodeKeyPrefix).toBe("do-7:");
    expect(revived.geo).toEqual({
      city: "Santiago",
      country: "CL",
      latitude: -33.45,
      longitude: -70.66,
    });
  });

  it("keeps the spent byte budget, so an eviction is not a free reset", () => {
    const socket = fakeSocket();
    const conn = new NodeConnection("do-1", socket, undefined);
    const now = 1_000_000;

    // Spend all but a sliver of the budget.
    expect(conn.chargeBytes(BYTE_BUDGET_BYTES - 10, now)).toBe(true);
    conn.persist();

    // The next frame must blow the budget even though the object was evicted
    // in between. This is the security-relevant case.
    const revived = evict(socket);
    expect(revived.chargeBytes(100, now)).toBe(false);
  });

  it("still expires old buckets after being restored", () => {
    const socket = fakeSocket();
    const conn = new NodeConnection("do-1", socket, undefined);
    const now = 1_000_000;
    conn.chargeBytes(BYTE_BUDGET_BYTES - 10, now);
    conn.persist();

    // A full window later the earlier spend has aged out, so the same frame
    // that would have been rejected above is now fine.
    const revived = evict(socket);
    expect(revived.chargeBytes(100, now + 60_000)).toBe(true);
  });

  it("keeps the connected cache that drives the ChainDO replay", () => {
    const socket = fakeSocket();
    const conn = new NodeConnection("do-1", socket, undefined);
    conn.rememberConnected(connected(3));
    conn.persist();

    const revived = evict(socket);
    expect(revived.recallConnected(3)).toEqual(connected(3));
    expect(revived.recallConnected(4)).toBeUndefined();
  });

  it("comes back live, not closed", () => {
    const socket = fakeSocket();
    const conn = new NodeConnection("do-1", socket, undefined);
    conn.markClosed();
    conn.persist();

    // `closed` is per-handler state, not a property of the connection: a
    // socket the runtime still delivers messages for is by definition open.
    expect(evict(socket).isClosed).toBe(false);
  });

  it("refuses a socket that was never attached to", () => {
    expect(NodeConnection.fromSocket(fakeSocket())).toBeUndefined();
  });
});
