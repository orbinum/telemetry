/**
 * RouteTable — maps (connection, message id) → genesis hash.
 *
 * The gateway needs it because a node's chain is only known once its
 * system.connected arrives, and one socket can multiplex nodes of different
 * chains. Pure bookkeeping: no sockets, no DO stubs.
 */

export class RouteTable {
  /** `connId:msgId` → genesis hash. */
  private routes = new Map<string, string>();
  /** connId → set of genesis hashes with at least one node on that connection. */
  private connChains = new Map<number, Set<string>>();

  /** Record where a node announced by system.connected lives. */
  register(connId: number, msgId: number, genesisHash: string): void {
    this.routes.set(`${connId}:${msgId}`, genesisHash);
    let chains = this.connChains.get(connId);
    if (chains === undefined) {
      chains = new Set();
      this.connChains.set(connId, chains);
    }
    chains.add(genesisHash);
  }

  /** The chain a message belongs to, or undefined before system.connected. */
  resolve(connId: number, msgId: number): string | undefined {
    return this.routes.get(`${connId}:${msgId}`);
  }

  /** Distinct node ids a connection has registered (for the Fase 5 cap). */
  nodeCount(connId: number): number {
    let count = 0;
    const prefix = `${connId}:`;
    for (const key of this.routes.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  }

  /** Forget a connection; returns the chains that must drop its nodes. */
  dropConnection(connId: number): string[] {
    const prefix = `${connId}:`;
    for (const key of this.routes.keys()) {
      if (key.startsWith(prefix)) this.routes.delete(key);
    }
    const chains = this.connChains.get(connId);
    this.connChains.delete(connId);
    return chains === undefined ? [] : [...chains];
  }
}
