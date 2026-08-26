/**
 * FeedBroadcaster — turns chain state changes into browser frames.
 *
 * Owns the batching window, the chunked initial snapshot, and the single
 * fanout call. The DO around it owns the sockets and the ingest RPCs; this
 * owns everything about *what* browsers receive and *when*.
 */

import { FEED_VERSION } from "../../../shared/protocol/feed";
import { toFeedChain, toFeedNode, toFeedNodeSeries } from "../feed/serialize";
import type { FeedMessage } from "../../../shared/protocol/feed";
import type { ChainState } from "../domain/chain-state";
import type { FeedHub } from "../feed/hub";
import type { OutboundSocket, SocketSource } from "../ports/transport";

/** Feed batching window (plan §5: 100 ms halves messages vs the reference's 75). */
const FLUSH_INTERVAL_MS = 100;

/** Nodes per frame in the initial snapshot (plan §5). */
const INIT_CHUNK_SIZE = 100;

/**
 * Chart series cadence. Deliberately far slower than the delta batch: the four
 * series are the bulk of a node's payload, and they are 20-point moving
 * averages, so a sparkline gains nothing from a 100 ms refresh.
 */
const SERIES_INTERVAL_MS = 5_000;

export type { SocketSource } from "../ports/transport";

export class FeedBroadcaster {
  private readonly hub: FeedHub;
  private readonly sockets: SocketSource;
  private flushTimer?: ReturnType<typeof setTimeout>;

  /** Last chain frame sent, so `chain` only goes out when aggregates moved. */
  private lastChainFrame = "";

  /**
   * Ids already introduced to browsers. A node absent from this set has never
   * been sent, so its delta must carry the session-fixed fields too.
   */
  private readonly introduced = new Set<number>();
  private lastSeriesAt = 0;

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
  sendSnapshot(socket: OutboundSocket, chain: ChainState | undefined, now: number): void {
    if (chain === undefined) {
      this.send(socket, {
        t: "init",
        v: FEED_VERSION,
        serverTime: now,
        chain: { genesisHash: "", label: "", nodeCount: 0 },
        nodes: [],
        done: true,
      });
      return;
    }

    const chainFrame = toFeedChain(chain);
    const entries = chain.list();
    const nodes = entries.map(({ id, node }) => toFeedNode(id, node, true));
    for (const { id } of entries) this.introduced.add(id);
    const chunks = Math.max(1, Math.ceil(nodes.length / INIT_CHUNK_SIZE));

    for (let i = 0; i < chunks; i++) {
      this.send(socket, {
        t: "init",
        v: FEED_VERSION,
        serverTime: now,
        chain: chainFrame,
        nodes: nodes.slice(i * INIT_CHUNK_SIZE, (i + 1) * INIT_CHUNK_SIZE),
        done: i === chunks - 1,
      });
    }

    // Sparklines would otherwise stay empty until the next series tick.
    if (entries.length > 0) {
      this.send(socket, {
        t: "series",
        n: entries.map(({ id, node }) => toFeedNodeSeries(id, node)),
      });
    }
  }

  /**
   * Re-send a node's session-fixed fields on its next delta. Called when
   * hwbench lands, which is the one such field that arrives after connect.
   */
  reintroduce(id: number): void {
    this.introduced.delete(id);
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
      for (const id of removed) this.introduced.delete(id);
      this.broadcast({ t: "rm", n: removed });
    }

    if (updated.length > 0) {
      const nodes = updated
        .map((id) => {
          const node = chain.getById(id);
          if (node === undefined) return undefined;
          const first = !this.introduced.has(id);
          if (first) this.introduced.add(id);
          return toFeedNode(id, node, first);
        })
        .filter((node) => node !== undefined);
      if (nodes.length > 0) this.broadcast({ t: "upd", n: nodes });
    }

    this.maybeSendSeries(chain);

    // Aggregates ride along with every batch, but only when they moved.
    const chainFrame = toFeedChain(chain);
    const serialized = JSON.stringify(chainFrame);
    if (chainChanged || serialized !== this.lastChainFrame) {
      this.lastChainFrame = serialized;
      this.broadcast({ t: "chain", c: chainFrame });
    }
  }

  /**
   * Broadcast every node's chart series, at most once per interval.
   *
   * Driven off the flush rather than its own timer: the flush already runs
   * whenever anything is pending, and a chain quiet enough to skip it has no
   * new samples to send either.
   */
  private maybeSendSeries(chain: ChainState): void {
    const now = Date.now();
    if (now - this.lastSeriesAt < SERIES_INTERVAL_MS) return;
    this.lastSeriesAt = now;

    const series = chain.list().map(({ id, node }) => toFeedNodeSeries(id, node));
    if (series.length > 0) this.broadcast({ t: "series", n: series });
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

  private send(socket: OutboundSocket, msg: FeedMessage): void {
    this.sendRaw(socket, JSON.stringify(msg));
  }

  private sendRaw(socket: OutboundSocket, frame: string): void {
    try {
      socket.send(frame);
    } catch {
      // A dying socket cleans itself up via close/error; never break the loop.
    }
  }
}
