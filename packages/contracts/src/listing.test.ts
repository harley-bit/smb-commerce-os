import { describe, expect, it } from "vitest";
import { createListingInputSchema, listingSchema, updateListingInputSchema } from "./listing.js";

const validListing = {
  id: "01977e6a-0000-7000-8000-000000000000",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  mode: "PRODUCT" as const,
  name: "Espresso Blend",
  slug: "espresso-blend",
  description: null,
  status: "DRAFT" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
  archivedAt: null,
};

describe("listingSchema", () => {
  it("accepts a well-formed listing row", () => {
    expect(listingSchema.parse(validListing)).toEqual(validListing);
  });

  it("rejects an unknown mode", () => {
    expect(() => listingSchema.parse({ ...validListing, mode: "SUBSCRIPTION" })).toThrow();
  });

  it("rejects a blank name", () => {
    expect(() => listingSchema.parse({ ...validListing, name: "" })).toThrow();
  });

  it("rejects a blank slug", () => {
    expect(() => listingSchema.parse({ ...validListing, slug: "" })).toThrow();
  });
});

describe("createListingInputSchema", () => {
  it("accepts a valid create payload without description", () => {
    const input = {
      mode: "SERVICE" as const,
      name: "Haircut",
      slug: "haircut",
      status: "DRAFT" as const,
      createdAt: "2026-09-08T00:00:00.000Z",
    };
    expect(createListingInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a missing mode", () => {
    expect(() =>
      createListingInputSchema.parse({
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("updateListingInputSchema", () => {
  it("accepts a partial patch with no mode field", () => {
    expect(updateListingInputSchema.parse({ name: "New name" })).toEqual({ name: "New name" });
  });

  it("accepts an empty patch", () => {
    expect(updateListingInputSchema.parse({})).toEqual({});
  });

  it("rejects a patch carrying a mode key — mode is immutable after creation", () => {
    expect(() =>
      updateListingInputSchema.parse({ name: "New name", mode: "RENTAL" }),
    ).toThrow();
  });
});
