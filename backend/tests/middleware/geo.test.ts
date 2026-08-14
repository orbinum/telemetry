import { describe, expect, it } from "vitest";
import { GEO_HEADER, geoHeaderValue, parseGeoHeader } from "../../src/middleware/geo";

function requestWithCf(cf: unknown): Request {
  return { cf } as unknown as Request;
}

describe("geoHeaderValue", () => {
  it("serializes the location fields of request.cf", () => {
    const value = geoHeaderValue(
      requestWithCf({
        city: "Santiago",
        country: "CL",
        latitude: "-33.45694",
        longitude: "-70.64827",
        asn: 12345, // extra cf fields must not leak into the header
      }),
    );
    expect(JSON.parse(value)).toEqual({
      city: "Santiago",
      country: "CL",
      latitude: -33.45694,
      longitude: -70.64827,
    });
  });

  it("returns an empty object when request.cf is absent (local dev, tests)", () => {
    expect(geoHeaderValue(requestWithCf(undefined))).toBe("{}");
  });

  it("omits coordinates when cf does not carry them", () => {
    const value = JSON.parse(geoHeaderValue(requestWithCf({ city: "Santiago" })));
    expect(value.latitude).toBeUndefined();
    expect(value.longitude).toBeUndefined();
  });
});

describe("parseGeoHeader", () => {
  it("round-trips what geoHeaderValue wrote", () => {
    const headers = new Headers({
      [GEO_HEADER]: geoHeaderValue(requestWithCf({ city: "Lima", country: "PE" })),
    });
    expect(parseGeoHeader(headers)).toEqual({ city: "Lima", country: "PE" });
  });

  it("returns undefined when the header is absent or malformed", () => {
    expect(parseGeoHeader(new Headers())).toBeUndefined();
    expect(parseGeoHeader(new Headers({ [GEO_HEADER]: "{not json" }))).toBeUndefined();
  });
});
