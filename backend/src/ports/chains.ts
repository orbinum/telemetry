/**
 * How a chain is reached, and by whom.
 *
 * Two seams, at two different levels: `ChainSink` is what the gateway needs of
 * a chain once it knows which one a node belongs to, and `ChainRegistry` is
 * what the HTTP layer needs to reach either kind of owner at all.
 */

import type { NodeGeo } from "../domain/node-state";
import type { NodeMessage, SystemConnectedMessage } from "../protocol/node";

/**
 * A chain's ingest surface.
 *
 * Exactly the three calls the gateway makes. Naming them here is what lets the
 * gateway stop importing the chain's implementation type purely to describe a
 * handle to it — the coupling was compile-time only, but it pointed the
 * dependency the wrong way.
 */
export interface ChainSink {
  nodeConnected(
    nodeKey: string,
    msg: SystemConnectedMessage,
    geo: NodeGeo | undefined,
  ): Promise<void>;
  /**
   * Apply a batch, returning the node keys this chain does not recognize so
   * the caller can replay their `system.connected` and retry just those.
   */
  nodeMessages(batch: Array<{ nodeKey: string; msg: NodeMessage }>): Promise<string[]>;
  connectionClosed(nodeKeyPrefix: string): Promise<void>;
}

/** Locates the chain owning a genesis hash. */
export type ChainSinkResolver = (genesisHash: string) => ChainSink;

/**
 * Anything that answers a request.
 *
 * The routes forward opaque upgrade requests and read back whatever comes out,
 * so this is the honest contract — narrower than a typed RPC and wide enough
 * for a WebSocket upgrade, which is a 101 response carrying a socket.
 */
export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Which owner holds what.
 *
 * Node sockets are spread across gateway partitions because a node's chain is
 * unknown until after the upgrade, so someone has to hold the socket and parse
 * before it can be routed. Feeds skip that hop: the browser names the chain in
 * the URL, so its socket goes straight to the owner.
 */
export interface ChainRegistry {
  /** The gateway owning this client's sockets. */
  gatewayFor(clientIp: string): Fetcher;
  /**
   * Every gateway, for the directory fan-in.
   *
   * A collection rather than an index, because how sockets are spread is the
   * host's business: this deployment splits them across four objects, another
   * might hold them all in one process. The caller only needs "ask them all".
   */
  gateways(): Fetcher[];
  /** The owner of one chain's state and feed sockets. */
  chain(genesisHash: string): Fetcher;
}
