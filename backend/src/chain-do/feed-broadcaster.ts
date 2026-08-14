/**
 * FeedBroadcaster — turns chain state changes into browser frames.
 *
 * Owns the batching window, the chunked initial snapshot, and the single
 * fanout call. The DO around it owns the sockets and the ingest RPCs; this
 * owns everything about *what* browsers receive and *when*.
 */

import { toFeedChain, toFeedNode } from "../feed/serialize";
import type { FeedMessage } from "../../../shared/protocol/feed";
import type { ChainState } from "../domain/chain-state";
import type { FeedHub } from "../feed/hub";

/** Feed batching window (plan §5: 100 ms halves messages vs the reference's 75). */
const FLUSH_INTERVAL_MS = 100;

/** Nodes per frame in the initial snapshot (plan §5). */
const INIT_CHUNK_SIZE = 100;

/** Supplies the live sockets — `ctx.getWebSockets()` in production. */
export type SocketSource = () => WebSocket[];

export class FeedBroadcaster {
  private readonly hub: FeedHub;
  private readonly sockets: SocketSource;
  private flushTimer?: ReturnType<typeof setTimeout>;
  /** Last chain frame sent, so `chain` only goes out when aggregates moved. */
  private lastChainFrame = "";

  constructor(hub: FeedHub, sockets: SocketSource) {
    this.hub = hub;
    this.sockets = sockets;
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Send the full state to one newly connected browser, 100 nodes per frame.
   * A chain that does not exist yet still gets a done-init, so the UI can
   * tell "connected and empty" from "still loading".
   */
  sendSnapshot(socket: WebSocket, chain: ChainState | undefined): void {
    if (chain === undefined) {
      this.send(socket, {
        t: "init",
        chain: { genesisHash: "", label: "", nodeCount: 0 },
        nodes: [],
        done: true,
      });
      return;
    }

    const chainFrame = toFeedChain(chain);
    const nodes = chain.list().map(({ id, node }) => toFeedNode(id, node));
    const chunks = Math.max(1, Math.ceil(nodes.length / INIT_CHUNK_SIZE));

    for (let i = 0; i < chunks; i++) {
      this.send(socket, {
        t: "init",
        chain: chainFrame,
        nodes: nodes.slice(i * INIT_CHUNK_SIZE, (i + 1) * INIT_CHUNK_SIZE),
        done: i === chunks - 1,
      });
    }
  }

  // ─── Batching ──────────────────────────────────────────────────────────────

  /** Arm the batch timer if anything is pending and none is armed yet. */
  schedule(chain: ChainState | undefined): void {
    if (this.flushTimer !== undefined || !this.hub.hasPending) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush(chain);
    }, FLUSH_INTERVAL_MS);
  }

  /** Drain everything pending into at most three frames. */
  flush(chain: ChainState | undefined): void {
    if (chain === undefined) return;
    const { updated, removed, chainChanged } = this.hub.drain();

    if (removed.length > 0) {
      this.broadcast({ t: "rm", n: removed });
    }

    if (updated.length > 0) {
      const nodes = updated
        .map((id) => {
          const node = chain.getById(id);
          return node === undefined ? undefined : toFeedNode(id, node);
        })
        .filter((node) => node !== undefined);
      if (nodes.length > 0) this.broadcast({ t: "upd", n: nodes });
    }

    // Aggregates ride along with every batch, but only when they moved.
    const chainFrame = toFeedChain(chain);
    const serialized = JSON.stringify(chainFrame);
    if (chainChanged || serialized !== this.lastChainFrame) {
      this.lastChainFrame = serialized;
      this.broadcast({ t: "chain", c: chainFrame });
    }
  }

  // ─── Fanout ────────────────────────────────────────────────────────────────

  /**
   * The single fanout call (plan §3.2's escape hatch): if one chain ever
   * exceeds a DO's capacity, this becomes an RPC to K FeedFanoutDOs and
   * nothing else in the codebase changes.
   */
  private broadcast(msg: FeedMessage): void {
    const frame = JSON.stringify(msg);
    for (const socket of this.sockets()) {
      this.sendRaw(socket, frame);
    }
  }

  private send(socket: WebSocket, msg: FeedMessage): void {
    this.sendRaw(socket, JSON.stringify(msg));
  }

  private sendRaw(socket: WebSocket, frame: string): void {
    try {
      socket.send(frame);
    } catch {
      // A dying socket cleans itself up via close/error; never break the loop.
    }
  }
}
