/**
 * The edge geo adapter.
 *
 * `request.cf` types its fields as unknown and fills them inconsistently —
 * coordinates arrive as strings — so the narrowing here is the difference
 * between a location and a row of `NaN`s on the map.
 */

import { describe, expect, it } from "vitest";
import { cloudflareGeo } from "../../../src/platform/cloudflare/geo";

function request(cf: unknown, headers: Record<string, string> = {}): Request {
  return { cf, headers: new Headers(headers) } as unknown as Request;
}

describe("locate", () => {
  it("takes the location fields and nothing else", () => {
    const geo = cloudflareGeo.locate(
      request({
        city: "Santiago",
        country: "CL",
        latitude: "-33.45694",
        longitude: "-70.64827",
        asn: 12345, // extra cf fields must not leak through
      }),
    );
    expect(geo).toEqual({
      city: "Santiago",
      country: "CL",
      latitude: -33.45694,
      longitude: -70.64827,
    });
  });

  it("has no location outside the edge (local dev, tests)", () => {
    expect(cloudflareGeo.locate(request(undefined))).toBeUndefined();
  });

  it("omits a coordinate that is not a number", () => {
    const geo = cloudflareGeo.locate(request({ city: "Santiago", latitude: "not-a-number" }));
    // Better an absent coordinate than a NaN plotted at the equator.
    expect(geo?.latitude).toBeUndefined();
    expect(geo?.city).toBe("Santiago");
  });

  it("omits a field the edge left as something other than text", () => {
    const geo = cloudflareGeo.locate(request({ city: 42 }));
    expect(geo?.city).toBeUndefined();
  });
});

describe("clientIp", () => {
  it("trusts the header the edge sets", () => {
    expect(cloudflareGeo.clientIp(request({}, { "CF-Connecting-IP": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to a single bucket off the edge", () => {
    // Everything shares one key in local dev, which is the safe direction:
    // it throttles more, never less.
    expect(cloudflareGeo.clientIp(request({}))).toBe("local");
  });
});
