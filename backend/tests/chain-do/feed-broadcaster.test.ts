/**
 * The broadcaster decides *what* each browser receives. The part worth testing
 * is the full-vs-delta split: session-fixed fields ship once, and a client that
 * never receives them renders empty hardware columns forever.
 */

import { describe, expect, it } from "vitest";
import { FeedBroadcaster } from "../../src/chain-do/feed-broadcaster";
import { ChainState } from "../../src/domain/chain-state";
import { FeedHub } from "../../src/feed/hub";
import type { OutboundSocket } from "../../src/ports/transport";
import type { FeedMessage, FeedNode } from "../../../shared/protocol/feed";
import type { SystemConnectedMessage } from "../../src/protocol/node";
import { peerId } from "../fixtures/peer-id";

const GENESIS = "0x" + "ab".repeat(32);

function connected(name: string): SystemConnectedMessage {
  return {
    msg: "system.connected",
    id: 1,
    genesisHash: GENESIS,
    node: {
      chain: "Orbinum Testnet",
      name,
      implementation: "Orbinum Node",
      version: "1.0.0",
      networkId: peerId(name),
      targetOs: "linux",
      sysinfo: { cpu: "Ryzen", coreCount: 16 },
    },
  };
}

/** A socket that only records what was written to it. */
function fakeSocket(): { sent: FeedMessage[]; socket: OutboundSocket } {
  const sent: FeedMessage[] = [];
  // No cast: the port is narrow enough that an object literal satisfies it.
  const socket: OutboundSocket = {
    send: (frame: string) => sent.push(JSON.parse(frame) as FeedMessage),
    close: () => {},
  };
  return { sent, socket };
}

function setup() {
  const hub = new FeedHub();
  const { sent, socket } = fakeSocket();
  const feed = new FeedBroadcaster(hub, () => [socket]);
  const chain = new ChainState(GENESIS);
  return { hub, feed, chain, sent };
}

/** Every node row across every `upd`/`init` frame, in order. */
function rows(sent: FeedMessage[]): FeedNode[] {
  return sent.flatMap((msg) => (msg.t === "upd" ? msg.n : msg.t === "init" ? msg.nodes : []));
}

describe("session-fixed fields", () => {
  it("sends them in the snapshot, then omits them from deltas", () => {
    const { hub, feed, chain, sent } = setup();
    const id = chain.addNode("1:1", connected("a"), undefined, 1000);

    // The snapshot goes to one specific browser, not the broadcast list.
    const { sent: snap, socket } = fakeSocket();
    feed.sendSnapshot(socket, chain, 1000);
    expect(rows(snap)[0].sysinfo?.coreCount).toBe(16);

    // A later delta for the same node carries only what changed.
    hub.markUpdated(id);
    feed.flush(chain);
    const delta = rows(sent).at(-1);
    expect(delta?.sysinfo).toBeUndefined();
    expect(delta?.targetOs).toBeUndefined();
  });

  it("carries them on the first delta for a node no browser has seen", () => {
    const { hub, feed, chain, sent } = setup();
    const id = chain.addNode("1:1", connected("a"), undefined, 1000);

    // No snapshot: the node's first appearance is the delta itself.
    hub.markUpdated(id);
    feed.flush(chain);
    expect(rows(sent)[0].sysinfo?.coreCount).toBe(16);

    hub.markUpdated(id);
    feed.flush(chain);
    expect(rows(sent).at(-1)?.sysinfo).toBeUndefined();
  });

  it("re-sends them after a reintroduce, which is how hwbench arrives", () => {
    const { hub, feed, chain, sent } = setup();
    const id = chain.addNode("1:1", connected("a"), undefined, 1000);
    hub.markUpdated(id);
    feed.flush(chain);

    chain.applyMessage(
      "1:1",
      { msg: "sysinfo.hwbench", id: 1, cpuHashrateScore: 1141, memoryMemcpyScore: 15832 },
      2000,
    );
    feed.reintroduce(id);
    hub.markUpdated(id);
    feed.flush(chain);

    expect(rows(sent).at(-1)?.hwbench?.cpuHashrateScore).toBe(1141);
  });

  it("re-introduces a node that left and came back", () => {
    const { hub, feed, chain, sent } = setup();
    const id = chain.addNode("1:1", connected("a"), undefined, 1000);
    hub.markUpdated(id);
    feed.flush(chain);

    hub.markRemoved([id]);
    feed.flush(chain);

    // Same id, fresh session: the browser dropped the row, so the fields have
    // to be sent again.
    hub.markUpdated(id);
    feed.flush(chain);
    expect(rows(sent).at(-1)?.sysinfo?.coreCount).toBe(16);
  });
});
