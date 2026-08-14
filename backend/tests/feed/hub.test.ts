import { describe, expect, it } from "vitest";
import { FeedHub } from "../../src/feed/hub";

describe("FeedHub", () => {
  it("coalesces repeated updates into one id", () => {
    const hub = new FeedHub();
    hub.markUpdated(1);
    hub.markUpdated(1);
    hub.markUpdated(2);
    expect(hub.drain().updated.sort()).toEqual([1, 2]);
  });

  it("drain resets the pending set", () => {
    const hub = new FeedHub();
    hub.markUpdated(1);
    hub.drain();
    expect(hub.hasPending).toBe(false);
    expect(hub.drain()).toEqual({ updated: [], removed: [], chainChanged: false });
  });

  it("a removal cancels a pending update for the same node", () => {
    const hub = new FeedHub();
    hub.markUpdated(1);
    hub.markUpdated(2);
    hub.markRemoved([1]);
    const pending = hub.drain();
    expect(pending.updated).toEqual([2]);
    expect(pending.removed).toEqual([1]);
  });

  it("an update after a removal in the same batch means the node came back", () => {
    const hub = new FeedHub();
    hub.markRemoved([1]);
    hub.markUpdated(1);
    const pending = hub.drain();
    expect(pending.updated).toEqual([1]);
    expect(pending.removed).toEqual([]);
  });

  it("removals imply the chain aggregates changed", () => {
    const hub = new FeedHub();
    hub.markRemoved([7]);
    expect(hub.drain().chainChanged).toBe(true);
  });

  it("hasPending tracks every kind of pending change", () => {
    const hub = new FeedHub();
    expect(hub.hasPending).toBe(false);
    hub.markChainChanged();
    expect(hub.hasPending).toBe(true);
  });
});
