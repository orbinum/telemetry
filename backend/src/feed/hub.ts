/**
 * FeedHub — accumulates what changed between feed flushes.
 *
 * The ingest path marks ids dirty as messages land; every ~100 ms the ChainDO
 * drains the hub and broadcasts one batched frame (plan §5). Pure
 * bookkeeping: no sockets, no timers.
 */

export interface FeedPending {
  updated: number[];
  removed: number[];
  chainChanged: boolean;
}

export class FeedHub {
  private updated = new Set<number>();
  private removed = new Set<number>();
  private chainChanged = false;

  markUpdated(id: number): void {
    this.updated.add(id);
    // An update after a removal within one batch means the node came back.
    this.removed.delete(id);
  }

  markRemoved(ids: number[]): void {
    for (const id of ids) {
      this.removed.add(id);
      this.updated.delete(id);
    }
    if (ids.length > 0) this.chainChanged = true;
  }

  markChainChanged(): void {
    this.chainChanged = true;
  }

  get hasPending(): boolean {
    return this.updated.size > 0 || this.removed.size > 0 || this.chainChanged;
  }

  /** Return everything pending and reset. */
  drain(): FeedPending {
    const pending: FeedPending = {
      updated: [...this.updated],
      removed: [...this.removed],
      chainChanged: this.chainChanged,
    };
    this.updated.clear();
    this.removed.clear();
    this.chainChanged = false;
    return pending;
  }
}
