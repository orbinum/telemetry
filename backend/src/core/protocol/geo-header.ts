/**
 * Node geolocation transfer between the Worker and the object holding the
 * socket.
 *
 * Whatever the edge knows about a request does not survive the hop, so the
 * Worker serializes the fields worth keeping into a header and the other side
 * reads it back. The header is the wire format between the two, which is why
 * both halves live here rather than with whichever adapter produced the
 * location.
 */

import type { NodeGeo } from "../domain/node-state";

export const GEO_HEADER = "X-Telemetry-Geo";

/** Serialize a location for the hop. */
export function geoHeaderValue(geo: NodeGeo | undefined): string {
  return geo === undefined ? "{}" : JSON.stringify(geo);
}

/** Read the header back on the far side; undefined if absent or malformed. */
export function parseGeoHeader(headers: Headers): NodeGeo | undefined {
  const raw = headers.get(GEO_HEADER);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as NodeGeo;
  } catch {
    // a malformed header only costs us the location column
    return undefined;
  }
}
