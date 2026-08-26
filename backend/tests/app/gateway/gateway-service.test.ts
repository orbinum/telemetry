/**
 * The gateway's socket lifecycle, which until now could not be driven without
 * a Durable Object and so had no tests of its own.
 *
 * What is worth pinning here is *order across the boundary*. A node must be
 * introduced to its chain before its own messages are applied, and its last
 * messages must not arrive after the chain was told it left — both are
 * enforced by flushes rather than by any type, and both produce plausible
 * behaviour when broken.
 */

import { describe, expect, it, vi } from "vitest";
import { GatewayService } from "../../../src/app/gateway/gateway-service";
import { CLOSE_TOO_MANY_NODES, MAX_NODES_PER_CONNECTION } from "../../../src/core/config/limits";
import { peerId } from "../../fixtures/peer-id";
import type { NodeConnectionState } from "../../../src/app/gateway/connection";
import type { ChainSink } from "../../../src/app/ports/chains";
import type { ChainDirectoryStore } from "../../../src/app/ports/directory";
import type { OutboundSocket, SocketAttachment } from "../../../src/app/ports/transport";

const GENESIS = "0x" + "aa".repeat(32);
const FOREIGN = "0x" + "bb".repeat(32);

/** The wire shape a node actually sends: an envelope around a payload. */
function connectedFrame(id: number, genesisHash = GENESIS): string {
  return JSON.stringify({
    id,
    payload: {
      msg: "system.connected",
      chain: "Orbinum Testnet",
      name: `node-${id}`,
      implementation: "Orbinum Node",
      version: "1.0.0",
      config: "",
      genesis_hash: genesisHash,
      network_id: peerId(id),
    },
  });
}

function intervalFrame(id: number): string {
  return JSON.stringify({ id, payload: { msg: "system.interval", peers: 4 } });
}

/** Records every call a chain receives, in the order it arrives. */
function setup(opts: { allowed?: string[]; existing?: Array<[OutboundSocket, string]> } = {}) {
  const calls: string[] = [];
  const sink: ChainSink = {
    nodeConnected: vi.fn(async (nodeKey: string) => {
      calls.push(`connected:${nodeKey}`);
    }),
    nodeMessages: vi.fn(async (batch) => {
      calls.push(`messages:${batch.map((entry: { nodeKey: string }) => entry.nodeKey).join(",")}`);
      return [];
    }),
    connectionClosed: vi.fn(async (prefix: string) => {
      calls.push(`closed:${prefix}`);
    }),
  };

  const held = new Map<OutboundSocket, string>();
  const attachment: SocketAttachment<NodeConnectionState> = {
    read: (socket) => {
      const raw = held.get(socket);
      return raw === undefined ? undefined : (JSON.parse(raw) as NodeConnectionState);
    },
    write: (socket, state) => held.set(socket, JSON.stringify(state)),
  };

  const directory = {
    record: vi.fn(),
    touch: vi.fn(),
    list: vi.fn(() => []),
    prune: vi.fn(),
  } as unknown as ChainDirectoryStore;

  const closed: Array<{ code: number; reason: string }> = [];
  const socket: OutboundSocket = {
    send: () => {},
    close: (code, reason) => closed.push({ code, reason }),
  };

  // Sockets a previous instance of this gateway left open, with the ids it
  // had given them — what survives an eviction.
  for (const [socket, id] of opts.existing ?? []) {
    attachment.write(socket, {
      id,
      bytes: { buckets: [], latestBucket: 0, sum: 0 },
      connected: [],
    });
  }

  const service = new GatewayService({
    clock: () => 1_000_000,
    directory,
    chainStub: () => sink,
    attachment,
    allowedChains: new Set(opts.allowed ?? [GENESIS]),
    idPrefix: "gw",
    existingSockets: (opts.existing ?? []).map(([socket]) => socket),
  });

  return { service, socket, calls, sink, directory, closed };
}

describe("ordering across the gateway boundary", () => {
  it("introduces a node before applying its messages", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());

    // Frames arrive one at a time per socket, which is the contract the
    // adapter owes this class.
    await t.service.handleFrame(t.socket, connectedFrame(1));
    await t.service.handleFrame(t.socket, intervalFrame(1));
    await t.service.handleClose(t.socket);

    const connectedAt = t.calls.indexOf("connected:gw-1:1");
    const messagesAt = t.calls.findIndex((c) => c.startsWith("messages:"));
    expect(connectedAt).toBeGreaterThanOrEqual(0);
    expect(messagesAt).toBeGreaterThan(connectedAt);
  });

  it("ships buffered messages before telling the chain the node left", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));
    await t.service.handleFrame(t.socket, intervalFrame(1));

    await t.service.handleClose(t.socket);

    // Reversed, the batch would be applied after the departure and resurrect
    // the node until the reaper swept it a minute later.
    const messagesAt = t.calls.findIndex((c) => c.startsWith("messages:"));
    const closedAt = t.calls.findIndex((c) => c.startsWith("closed:"));
    expect(messagesAt).toBeGreaterThanOrEqual(0);
    expect(closedAt).toBeGreaterThan(messagesAt);
  });

  it("tells every chain a socket fed that it is gone", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));

    await t.service.handleClose(t.socket);
    expect(t.calls).toContain("closed:gw-1:");
  });
});

describe("connection ids", () => {
  it("gives each socket its own id", async () => {
    const t = setup();
    const second: OutboundSocket = { send: () => {}, close: () => {} };

    t.service.accept(t.socket, new Headers());
    t.service.accept(second, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));
    await t.service.handleFrame(second, connectedFrame(1));

    // Same envelope id on two sockets must not collide: the chain pools every
    // gateway's connections into one table.
    expect(t.calls).toContain("connected:gw-1:1");
    expect(t.calls).toContain("connected:gw-2:1");
  });
});

describe("frames the gateway refuses", () => {
  it("ignores a socket it never accepted", async () => {
    const t = setup();
    const stranger: OutboundSocket = { send: () => {}, close: () => {} };

    await t.service.handleFrame(stranger, connectedFrame(1));
    expect(t.calls).toEqual([]);
  });

  it("drops an unparseable frame without touching a chain", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());

    await t.service.handleFrame(t.socket, "not json at all");
    expect(t.calls).toEqual([]);
  });

  it("drops messages that arrive before system.connected", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());

    await t.service.handleFrame(t.socket, intervalFrame(1));
    await t.service.handleClose(t.socket);
    expect(t.calls.filter((c) => c.startsWith("messages:"))).toEqual([]);
  });

  it("closes a socket that claims more nodes than it may", async () => {
    const t = setup();
    t.service.accept(t.socket, new Headers());

    for (let id = 1; id <= MAX_NODES_PER_CONNECTION + 1; id++) {
      await t.service.handleFrame(t.socket, connectedFrame(id));
    }

    // One connection must not be able to fill a chain's memory with nodes.
    expect(t.closed).toContainEqual({
      code: CLOSE_TOO_MANY_NODES,
      reason: "too many nodes on one connection",
    });
  });

  it("never routes a chain outside the allowlist", async () => {
    const t = setup({ allowed: [GENESIS] });
    t.service.accept(t.socket, new Headers());

    await t.service.handleFrame(t.socket, connectedFrame(1, FOREIGN));
    expect(t.calls).toEqual([]);
  });
});

describe("the directory", () => {
  it("prunes on read, so it stays bounded without a timer", () => {
    const t = setup();
    t.service.listChains();
    expect(t.directory.prune).toHaveBeenCalled();
  });
});

describe("resuming connection ids after an eviction", () => {
  const other = (): OutboundSocket => ({ send: () => {}, close: () => {} });

  it("resumes past the highest id still connected", async () => {
    // The object died; these sockets did not. Restarting the counter at 1
    // would hand a new socket the id of one still streaming, and since both
    // build the same node keys, the older node would be silently replaced.
    const survivor = other();
    const t = setup({ existing: [[survivor, "gw-7"]] });

    t.service.accept(t.socket, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));

    expect(t.calls).toContain("connected:gw-8:1");
  });

  it("ignores ids belonging to a different gateway", async () => {
    // Another partition's sockets are not this one's to number past.
    const foreign = other();
    const t = setup({ existing: [[foreign, "elsewhere-99"]] });

    t.service.accept(t.socket, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));

    expect(t.calls).toContain("connected:gw-1:1");
  });

  it("ignores an id whose number cannot be trusted", async () => {
    // The attachment is only as good as the last write; an unparseable id is
    // skipped rather than allowed to poison the counter.
    const broken = other();
    const t = setup({ existing: [[broken, "gw-not-a-number"]] });

    t.service.accept(t.socket, new Headers());
    await t.service.handleFrame(t.socket, connectedFrame(1));

    expect(t.calls).toContain("connected:gw-1:1");
  });
});
