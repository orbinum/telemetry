import { describe, expect, it } from "vitest";
import { GEO_HEADER, geoHeaderValue, parseGeoHeader } from "../../../src/core/protocol/geo-header";

/** A location as the edge adapter would have produced it. */
const SANTIAGO = { city: "Santiago", country: "CL", latitude: -33.45694, longitude: -70.64827 };

describe("geoHeaderValue", () => {
  it("serializes a location for the hop", () => {
    expect(JSON.parse(geoHeaderValue(SANTIAGO))).toEqual(SANTIAGO);
  });

  it("returns an empty object when there is no location", () => {
    expect(geoHeaderValue(undefined)).toBe("{}");
  });

  it("omits fields the edge did not provide", () => {
    const value = JSON.parse(geoHeaderValue({ city: "Santiago" }));
    expect(value.latitude).toBeUndefined();
    expect(value.longitude).toBeUndefined();
  });
});

describe("parseGeoHeader", () => {
  it("round-trips what geoHeaderValue wrote", () => {
    const headers = new Headers({
      [GEO_HEADER]: geoHeaderValue({ city: "Lima", country: "PE" }),
    });
    expect(parseGeoHeader(headers)).toEqual({ city: "Lima", country: "PE" });
  });

  it("returns undefined when the header is absent or malformed", () => {
    expect(parseGeoHeader(new Headers())).toBeUndefined();
    expect(parseGeoHeader(new Headers({ [GEO_HEADER]: "{not json" }))).toBeUndefined();
  });
});
