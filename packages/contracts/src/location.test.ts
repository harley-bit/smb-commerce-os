import { describe, expect, it } from "vitest";
import { locationSchema } from "./location.js";

const validLocation = {
  id: "01977e6a-0000-7000-8000-000000000000",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  name: "Main",
  timezone: "America/New_York",
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  archivedAt: null,
};

describe("locationSchema", () => {
  it("accepts a well-formed location row", () => {
    expect(locationSchema.parse(validLocation)).toEqual(validLocation);
  });

  it("rejects an empty timezone", () => {
    expect(() => locationSchema.parse({ ...validLocation, timezone: "" })).toThrow();
  });

  it("rejects a missing name", () => {
    expect(() => locationSchema.parse({ ...validLocation, name: "" })).toThrow();
  });
});
