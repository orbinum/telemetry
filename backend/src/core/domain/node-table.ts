/**
 * NodeTable — node identity and lifecycle for one chain.
 *
 * A node is identified by `connId:messageId`, never by its name: `--name` is
 * a free-form label and two machines may legitimately share one. The table
 * also assigns the stable numeric id the feed uses, so a node that
 * re-announces under the same key keeps its row in the UI instead of
 * flickering as a remove + add.
 *
 * Pure: no sockets, no clock — time enters as a parameter.
 */

import { NodeState } from "./node-state";
import type { NodeGeo } from "./node-state";
import type { SystemConnectedMessage } from "../protocol/node";

export interface NodeEntry {
  key: string;
  id: number;
  node: NodeState;
}

export class NodeTable {
  private readonly nodes = new Map<string, NodeState>();
  private readonly ids = new Map<string, number>();
  private nextId = 1;

  /** Register (or replace) a node; returns its stable feed id. */
  add(key: string, msg: SystemConnectedMessage, geo: NodeGeo | undefined, now: number): number {
    this.nodes.set(key, new NodeState(msg, geo, now));
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(key, id);
    }
    return id;
  }

  get(key: string): NodeState | undefined {
    return this.nodes.get(key);
  }

  idOf(key: string): number | undefined {
    return this.ids.get(key);
  }

  getById(id: number): NodeState | undefined {
    for (const [key, nodeId] of this.ids) {
      if (nodeId === id) return this.nodes.get(key);
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.nodes.has(key);
  }

  get size(): number {
    return this.nodes.size;
  }

  entries(): NodeEntry[] {
    return [...this.nodes.entries()].map(([key, node]) => ({
      key,
      id: this.ids.get(key) ?? 0,
      node,
    }));
  }

  values(): Iterable<NodeState> {
    return this.nodes.values();
  }

  /** Remove every node of one connection; returns the feed ids that left. */
  removeByPrefix(prefix: string): number[] {
    return this.removeWhere((key) => key.startsWith(prefix)).map((entry) => entry.id);
  }

  /** Remove nodes that stopped reporting; returns the feed ids that left. */
  removeExpired(now: number, timeoutMs: number): number[] {
    return this.removeWhere((_key, node) => node.isExpired(now, timeoutMs)).map(
      (entry) => entry.id,
    );
  }

  /**
   * The same removals, but keeping the node that left rather than only its
   * feed id — a departure is the moment a session ends, and the state is gone
   * immediately after.
   */
  takeByPrefix(prefix: string): NodeEntry[] {
    return this.removeWhere((key) => key.startsWith(prefix));
  }

  takeExpired(now: number, timeoutMs: number): NodeEntry[] {
    return this.removeWhere((_key, node) => node.isExpired(now, timeoutMs));
  }

  private removeWhere(predicate: (key: string, node: NodeState) => boolean): NodeEntry[] {
    const removed: NodeEntry[] = [];
    for (const [key, node] of this.nodes) {
      if (!predicate(key, node)) continue;
      const id = this.ids.get(key);
      if (id !== undefined) removed.push({ key, id, node });
      this.nodes.delete(key);
      this.ids.delete(key);
    }
    return removed;
  }

  /**
   * The most common chain label among nodes — a cheap stand-in for the
   * reference's MostSeen. Nodes of one chain can disagree on the label
   * (a stale binary, a typo), so the majority wins.
   */
  get label(): string {
    const counts = new Map<string, number>();
    for (const node of this.nodes.values()) {
      counts.set(node.details.chain, (counts.get(node.details.chain) ?? 0) + 1);
    }

    let best = "";
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    return best;
  }
}
