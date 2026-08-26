/**
 * The hibernation attachment.
 *
 * Small, but it sits on the eviction path: everything a node connection knows
 * — its id, its geo, its spent byte budget — travels through here while the
 * object is not resident. The one piece of logic is the `null` the runtime
 * returns for a socket it holds no attachment for, translated to `undefined`.
 *
 * That translation is load-bearing. `NodeConnection.fromSocket` treats
 * `undefined` as "a socket this instance never accepted" and ignores the
 * frame; a raw `null` reaching it would be an object, and the connection would
 * be rebuilt from nothing.
 */

import { describe, expect, it } from "vitest";
import { hibernationAttachment } from "../../../src/platform/cloudflare/socket-attachment";
import type { OutboundSocket } from "../../../src/app/ports/transport";

interface State {
  id: string;
  spent: number;
}

/**
 * A socket with the runtime's attachment API. It stores the value as-is,
 * matching structured clone rather than JSON — which is what the runtime does.
 */
function fakeSocket(initial: unknown = null) {
  let held: unknown = initial;
  return {
    serializeAttachment: (value: unknown) => {
      held = value;
    },
    deserializeAttachment: () => held,
    send: () => {},
    close: () => {},
  } as unknown as OutboundSocket;
}

describe("hibernationAttachment", () => {
  it("round-trips state through the socket", () => {
    const attachment = hibernationAttachment<State>();
    const socket = fakeSocket();

    attachment.write(socket, { id: "gw-1", spent: 4096 });

    expect(attachment.read(socket)).toEqual({ id: "gw-1", spent: 4096 });
  });

  it("reports a socket the runtime holds nothing for as undefined", () => {
    // The runtime answers `null` here, but callers branch on `undefined` — a
    // `null` reaching `NodeConnection.fromSocket` is an object, so a socket
    // this instance never accepted would be rebuilt from nothing.
    expect(hibernationAttachment<State>().read(fakeSocket())).toBeUndefined();
  });

  it("overwrites rather than accumulating", () => {
    const attachment = hibernationAttachment<State>();
    const socket = fakeSocket();

    attachment.write(socket, { id: "gw-1", spent: 1 });
    attachment.write(socket, { id: "gw-1", spent: 2 });

    // The budget is rewritten after every frame; keeping the older value would
    // let a client spend it twice.
    expect(attachment.read(socket)?.spent).toBe(2);
  });

  it("keeps each socket's state to itself", () => {
    const attachment = hibernationAttachment<State>();
    const first = fakeSocket();
    const second = fakeSocket();

    attachment.write(first, { id: "gw-1", spent: 10 });
    attachment.write(second, { id: "gw-2", spent: 20 });

    expect(attachment.read(first)?.id).toBe("gw-1");
    expect(attachment.read(second)?.id).toBe("gw-2");
  });

  it("survives a value the object never wrote itself", () => {
    // After an eviction the attachment was written by a previous instance;
    // reading it must not depend on having written it in this one.
    const socket = fakeSocket({ id: "gw-7", spent: 99 });
    expect(hibernationAttachment<State>().read(socket)).toEqual({ id: "gw-7", spent: 99 });
  });
});
