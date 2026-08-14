/**
 * Feed client — lives outside React on purpose (plan §8).
 *
 * The socket writes into a plain Map and buffers what changed; the buffer is
 * flushed once per animation frame. That is what turns ~1.000 msg/s into ≤60
 * store commits/s and keeps 500 rows renderable. No setState per message,
 * ever.
 */

import { parseFeedMessage } from "../../../shared/protocol/feed";
import type { FeedChain, FeedNode } from "../../../shared/protocol/feed";

export type FeedStatus = "connecting" | "live" | "reconnecting";

export interface FeedSnapshot {
  nodes: Map<number, FeedNode>;
  chain?: FeedChain;
  status: FeedStatus;
}

type Listener = (snapshot: FeedSnapshot) => void;

const RECONNECT_DELAY_MS = 2000;

export class FeedClient {
  private socket?: WebSocket;
  private nodes = new Map<number, FeedNode>();
  private chain?: FeedChain;
  private status: FeedStatus = "connecting";

  /** Ids touched since the last frame; empty means nothing to publish. */
  private dirty = false;
  private frame?: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private listeners = new Set<Listener>();

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

    socket.onopen = () => this.setStatus("live");
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      this.apply(event.data);
    };
    socket.onclose = () => this.scheduleReconnect();
    socket.onerror = () => socket.close();
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
        // A fresh init after a reconnect replaces the world: the first chunk
        // clears, later chunks accumulate.
        if (this.isFirstInitChunk) this.nodes.clear();
        this.isFirstInitChunk = msg.done;
        this.chain = msg.chain;
        for (const node of msg.nodes) this.nodes.set(node.id, node);
        break;
      case "upd":
        // Upsert semantics: an unknown id is a new node.
        for (const node of msg.n) this.nodes.set(node.id, node);
        break;
      case "rm":
        for (const id of msg.n) this.nodes.delete(id);
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
      chain: this.chain,
      status: this.status,
    };
    for (const listener of this.listeners) listener(snapshot);
  }
}
