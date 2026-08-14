/**
 * Node geolocation transfer between the Worker and the Durable Object.
 *
 * `request.cf` (geo, ASN, colo) does not survive the hop into a DO, so the
 * Worker serializes the fields we keep into a header and the DO reads it back.
 */

import type { NodeGeo } from "../domain/node-state";

export const GEO_HEADER = "X-Telemetry-Geo";

/** Serialize the location fields of `request.cf` for the DO hop. */
export function geoHeaderValue(request: Request): string {
  const cf = request.cf;
  if (!cf) return "{}";
  return JSON.stringify({
    city: cf.city,
    country: cf.country,
    latitude: cf.latitude === undefined ? undefined : Number(cf.latitude),
    longitude: cf.longitude === undefined ? undefined : Number(cf.longitude),
  });
}

/** Read the geo header back on the DO side; undefined if absent or malformed. */
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
