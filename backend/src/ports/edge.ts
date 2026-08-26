/**
 * What the network edge in front of this service is expected to provide:
 * connection throttling, the client's address, and where that client is.
 *
 * Both are edge features rather than domain rules, and both degrade rather
 * than fail — a request with no location still becomes a node, and one the
 * limiter cannot rule on is allowed.
 */

import type { NodeGeo } from "../domain/node-state";

/**
 * Throttles how often a client may open a connection.
 *
 * Fails OPEN: an unavailable limiter allows the request. It exists to stop a
 * client from cycling sockets in a loop, not to enforce correctness, so an
 * outage in it must never take ingest down with it. Note it only ever sees the
 * upgrade — traffic on an already-open socket is bounded by the connection's
 * own byte budget instead, since those frames never reach the edge again.
 */
export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

/**
 * Attributes a request to a client and, where the edge knows, to a place.
 *
 * `clientIp` is the limiter's key, so how much it can be trusted is a property
 * of the deployment: an edge that sets the address itself is authoritative,
 * while a proxy-forwarded header is only as good as the proxy in front of it.
 * An implementation reading a forwarded header must know which proxies it
 * trusts, or IP-keyed limiting is spoofable.
 */
export interface GeoResolver {
  clientIp(request: Request): string;
  /** Where this client is, or undefined where the edge provides nothing. */
  locate(request: Request): NodeGeo | undefined;
}
