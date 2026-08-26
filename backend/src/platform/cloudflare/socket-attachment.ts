/**
 * `SocketAttachment` over the hibernation API.
 *
 * A Durable Object using hibernatable sockets is evicted while those sockets
 * stay open, so per-socket state cannot live in a field. The runtime keeps an
 * attachment alongside each socket and hands it back when the object wakes;
 * this is the whole of what that costs.
 *
 * The value crosses a structured-clone boundary, so it must be plain data —
 * which is why `NodeConnectionState` holds the connected cache as entries
 * rather than as the Map it is used as.
 */

import type { OutboundSocket, SocketAttachment } from "../../app/ports/transport";

/** Reads and writes state on the socket itself. */
export function hibernationAttachment<T>(): SocketAttachment<T> {
  return {
    read(socket: OutboundSocket): T | undefined {
      const state = (socket as WebSocket).deserializeAttachment() as T | null;
      return state === null ? undefined : state;
    },
    write(socket: OutboundSocket, state: T): void {
      (socket as WebSocket).serializeAttachment(state);
    },
  };
}
