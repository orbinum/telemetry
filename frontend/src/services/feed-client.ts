/**
 * Feed client — lives outside React on purpose (plan §8).
 *
 * The socket writes into a plain Map and buffers what changed; the buffer is
 * flushed once per animation frame. That is what turns ~1.000 msg/s into ≤60
 * store commits/s and keeps 500 rows renderable. No setState per message,
 * ever.
 */

import { FEED_VERSION, parseFeedMessage } from "../../../shared/protocol/feed";
import type { FeedChain, FeedNode, FeedNodeSeries } from "../../../shared/protocol/feed";

/** `outdated` is terminal — only fresh code recovers; the rest self-heal. */
export type FeedStatus = "connecting" | "live" | "reconnecting" | "outdated";

export interface FeedSnapshot {
  nodes: Map<number, FeedNode>;
  /** Chart series, keyed by node id. Updated on their own slower cadence. */
  series: Map<number, FeedNodeSeries>;
  chain?: FeedChain;
  status: FeedStatus;
  /** Add to `Date.now()` for the server's clock; 0 until the first init. */
  clockOffset: number;
}

type Listener = (snapshot: FeedSnapshot) => void;

const RECONNECT_DELAY_MS = 2000;

/**
 * Detects a half-open socket — dropped without a FIN, so `close` never fires
 * and the UI keeps reporting "live" over frozen data. Two intervals of silence
 * rather than one, so a single delayed frame does not tear down a live
 * connection.
 */
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;

/** `WebSocket.OPEN`, spelled out so the check does not depend on the global. */
const SOCKET_OPEN = 1;

export class FeedClient {
  private socket?: WebSocket;
  private nodes = new Map<number, FeedNode>();
  private series: Map<number, FeedNodeSeries> = new Map();
  private chain?: FeedChain;
  private status: FeedStatus = "connecting";

  /** Ids touched since the last frame; empty means nothing to publish. */
  private dirty = false;
  private frame?: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private listeners = new Set<Listener>();
  private clockOffset = 0;
  private pingTimer?: ReturnType<typeof setInterval>;
  /** When the last frame of any kind arrived; 0 before the socket opens. */
  private lastSeen = 0;

  private readonly genesisHash: string;
  /** ws:// or wss:// base of the worker serving this chain. */
  private readonly wsBase: string;

  constructor(genesisHash: string, wsBase: string) {
    this.genesisHash = genesisHash;
    this.wsBase = wsBase;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  disconnect(): void {
    this.closed = true;
    this.stopKeepalive();
    clearTimeout(this.reconnectTimer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  // ─── Socket ────────────────────────────────────────────────────────────────

  private open(): void {
    const socket = new WebSocket(`${this.wsBase}/feed/${this.genesisHash}`);
    this.socket = socket;

    socket.onopen = () => {
      this.setStatus("live");
      this.startKeepalive();
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      // Any frame proves liveness, not just a pong: a busy chain may never
      // leave a gap long enough to notice.
      this.lastSeen = Date.now();
      if (event.data === "pong") return;
      this.apply(event.data);
    };
    socket.onclose = () => {
      this.stopKeepalive();
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  // ─── Keepalive ─────────────────────────────────────────────────────────────

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastSeen = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState !== SOCKET_OPEN) return;
      // Before pinging, so the gap measured always covers a full interval.
      if (Date.now() - this.lastSeen > PONG_TIMEOUT_MS) {
        // By hand: a half-open socket never closes itself, and `onclose` is
        // what drives the reconnect.
        this.stopKeepalive();
        this.setStatus("reconnecting");
        this.socket.close();
        return;
      }
      this.socket.send("ping");
    }, PING_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  /** Give up for good: reconnecting would loop against an unreadable server. */
  private markOutdated(): void {
    this.closed = true;
    this.stopKeepalive();
    clearTimeout(this.reconnectTimer);
    this.setStatus("outdated");
    this.socket?.close();
    this.socket = undefined;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.setStatus("reconnecting");
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), RECONNECT_DELAY_MS);
  }

  private setStatus(status: FeedStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.markDirty();
  }

  // ─── Message application ───────────────────────────────────────────────────

  private apply(raw: string): void {
    // A frame can arrive after disconnect() (the socket closes asynchronously);
    // applying it would resurrect a dead feed's state.
    if (this.closed) return;
    const msg = parseFeedMessage(raw);
    if (msg === null) return;

    switch (msg.t) {
      case "init":
        // Before anything is applied: these nodes may be shaped in a way this
        // build misreads.
        if (msg.v !== FEED_VERSION) {
          this.markOutdated();
          return;
        }
        // Per init, so a reconnect re-syncs a clock that drifted during sleep.
        this.clockOffset = msg.serverTime - Date.now();
        // A fresh init after a reconnect replaces the world: the first chunk
        // clears, later chunks accumulate.
        if (this.isFirstInitChunk) {
          this.nodes.clear();
          this.series = new Map();
        }
        this.isFirstInitChunk = msg.done;
        this.chain = msg.chain;
        for (const node of msg.nodes) this.nodes.set(node.id, node);
        break;
      case "upd":
        // Upsert semantics: an unknown id is a new node. Merged rather than
        // replaced — a delta omits the immutable fields, and overwriting the
        // row would drop the sysinfo that only ever arrives once.
        for (const node of msg.n) {
          const previous = this.nodes.get(node.id);
          this.nodes.set(node.id, previous === undefined ? node : { ...previous, ...node });
        }
        break;
      case "series":
        // New identity so a memoized consumer sees the change; the entries
        // themselves are shared, like the node rows.
        this.series = new Map(this.series);
        for (const entry of msg.n) this.series.set(entry.id, entry);
        break;
      case "rm":
        this.series = new Map(this.series);
        for (const id of msg.n) {
          this.nodes.delete(id);
          this.series.delete(id);
        }
        break;
      case "chain":
        this.chain = msg.c;
        break;
    }
    this.markDirty();
  }

  /** True while waiting for the first chunk of an init sequence. */
  private isFirstInitChunk = true;

  private markDirty(): void {
    this.dirty = true;
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (!this.dirty) return;
      this.dirty = false;
      this.publish();
    });
  }

  private publish(): void {
    // A new Map identity per frame is what lets React see the change; the
    // rows themselves are the same objects, so memo'd rows stay memo'd.
    const snapshot: FeedSnapshot = {
      nodes: new Map(this.nodes),
      series: this.series,
      chain: this.chain,
      status: this.status,
      clockOffset: this.clockOffset,
    };
    for (const listener of this.listeners) listener(snapshot);
  }
}
