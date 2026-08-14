import { describe, expect, it } from "vitest";
import { RouteTable } from "../../src/gateway-do/route-table";

const CHAIN_A = "0x" + "aa".repeat(32);
const CHAIN_B = "0x" + "bb".repeat(32);

describe("RouteTable", () => {
  it("resolves a node to the chain its system.connected announced", () => {
    const table = new RouteTable();
    table.register(1, 1, CHAIN_A);
    table.register(1, 2, CHAIN_B); // one socket, two chains
    expect(table.resolve(1, 1)).toBe(CHAIN_A);
    expect(table.resolve(1, 2)).toBe(CHAIN_B);
    expect(table.resolve(1, 3)).toBeUndefined();
  });

  it("counts node ids per connection", () => {
    const table = new RouteTable();
    table.register(1, 1, CHAIN_A);
    table.register(1, 2, CHAIN_A);
    table.register(2, 1, CHAIN_A);
    expect(table.nodeCount(1)).toBe(2);
    expect(table.nodeCount(2)).toBe(1);
  });

  it("dropConnection returns the affected chains and forgets the routes", () => {
    const table = new RouteTable();
    table.register(1, 1, CHAIN_A);
    table.register(1, 2, CHAIN_B);
    table.register(2, 1, CHAIN_A);

    const chains = table.dropConnection(1);
    expect(chains.sort()).toEqual([CHAIN_A, CHAIN_B].sort());
    expect(table.resolve(1, 1)).toBeUndefined();
    expect(table.resolve(2, 1)).toBe(CHAIN_A); // untouched
    expect(table.dropConnection(999)).toEqual([]);
  });

  it("does not confuse connection 1 with connection 11", () => {
    const table = new RouteTable();
    table.register(1, 1, CHAIN_A);
    table.register(11, 1, CHAIN_B);
    table.dropConnection(1);
    expect(table.resolve(11, 1)).toBe(CHAIN_B);
    expect(table.nodeCount(11)).toBe(1);
  });
});
