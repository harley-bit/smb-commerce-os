import { describe, expect, it } from "vitest";
import { publicListingSchema, publicMerchantProfileSchema } from "./publicStorefront.js";

describe("publicMerchantProfileSchema", () => {
  it("accepts a well-formed public profile", () => {
    const profile = { name: "Acme Rentals", slug: "acme-rentals", defaultCurrency: "USD" };
    expect(publicMerchantProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects a payload carrying an internal merchant id", () => {
    expect(() =>
      publicMerchantProfileSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000001",
        name: "Acme Rentals",
        slug: "acme-rentals",
        defaultCurrency: "USD",
      }),
    ).toThrow();
  });
});

describe("publicListingSchema", () => {
  it("accepts a well-formed public listing, no merchantId", () => {
    const listing = {
      id: "01977e6a-0000-7000-8000-000000000000",
      mode: "PRODUCT" as const,
      name: "Espresso Blend",
      slug: "espresso-blend",
      description: null,
    };
    expect(publicListingSchema.parse(listing)).toEqual(listing);
  });

  it("rejects a payload carrying an internal merchantId", () => {
    expect(() =>
      publicListingSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000000",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        mode: "PRODUCT",
        name: "Espresso Blend",
        slug: "espresso-blend",
        description: null,
      }),
    ).toThrow();
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      publicListingSchema.parse({
        id: "01977e6a-0000-7000-8000-000000000000",
        mode: "SUBSCRIPTION",
        name: "Espresso Blend",
        slug: "espresso-blend",
        description: null,
      }),
    ).toThrow();
  });
});
