/**
 * WebSockets, as this code actually uses them.
 *
 * Narrower than the WHATWG interface on purpose: the broadcaster and the node
 * connection only ever write and close, so naming those two methods makes a
 * test double an object literal rather than a cast, and makes it obvious that
 * nothing here depends on the rest of the surface.
 */

/** A socket we can write to and close. */
export interface OutboundSocket {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

/**
 * The live sockets of one owner.
 *
 * A function because the set changes underneath the caller — a socket may have
 * closed since the last frame — so it has to be read at each broadcast rather
 * than captured.
 */
export type SocketSource = () => OutboundSocket[];

/**
 * Per-socket state that must outlive whatever is holding it.
 *
 * On Workers this is the hibernation attachment: the object is evicted while
 * sockets stay open, so a field would come back empty. That matters most for
 * the byte budget — a client able to drop the object at will would otherwise
 * reset its own rate limit for free. A host that never evicts can key a plain
 * map by socket and satisfy the same contract.
 */
export interface SocketAttachment<T> {
  read(socket: OutboundSocket): T | undefined;
  write(socket: OutboundSocket, state: T): void;
}

/**
 * ORDERING CONTRACT — the one guarantee this layer cannot check for itself.
 *
 * An adapter MUST NOT deliver a frame for a socket while the handler of that
 * socket's previous frame is still pending. Frames from *different* sockets may
 * interleave freely; frames from one socket may not.
 *
 * The ingest path depends on it and has no defence of its own: a node's
 * `system.connected` must reach its chain before the intervals that follow it,
 * and a chain that applied them in the other order would reject the intervals
 * as belonging to a node it has never heard of.
 *
 * Cloudflare's runtime provides this — it awaits `webSocketMessage` before
 * delivering the next frame of that socket — which is why the promise chain
 * that used to enforce it by hand could be deleted. A host built on a library
 * that does not await its handler must put that chain back. This paragraph is
 * the whole reason it is written down here rather than assumed.
 */
