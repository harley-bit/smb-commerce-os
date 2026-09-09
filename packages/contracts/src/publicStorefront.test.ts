import { describe, expect, it } from "vitest";
import {
  publicListingSchema,
  publicMerchantProfileSchema,
  publicProductDetailSchema,
  publicVariantSchema,
} from "./publicStorefront.js";

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

describe("publicVariantSchema", () => {
  it("accepts a well-formed public variant with a bucketed stock status", () => {
    const variant = {
      id: "01977e6a-0000-7000-8000-000000000002",
      sku: "SWEATER-M",
      name: "Medium",
      priceMinor: 4500,
      currency: "USD",
      attributesJson: null,
      stockStatus: "IN_STOCK" as const,
    };
    expect(publicVariantSchema.parse(variant)).toEqual(variant);
  });

  it("rejects an unknown stock status", () => {
    expect(() =>
      publicVariantSchema.parse({
        id: "01977e6a-0000-7000-8000-000000000002",
        sku: "SWEATER-M",
        name: "Medium",
        priceMinor: 4500,
        currency: "USD",
        attributesJson: null,
        stockStatus: "LOW_STOCK",
      }),
    ).toThrow();
  });

  it("rejects a payload carrying a raw stock quantity — this card's security check", () => {
    expect(() =>
      publicVariantSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000002",
        sku: "SWEATER-M",
        name: "Medium",
        priceMinor: 4500,
        currency: "USD",
        attributesJson: null,
        stockStatus: "IN_STOCK",
        quantityOnHand: 3,
      }),
    ).toThrow();
  });

  it("rejects a payload carrying an internal merchantId or listingId", () => {
    expect(() =>
      publicVariantSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000002",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        listingId: "01977e6a-0000-7000-8000-000000000000",
        sku: "SWEATER-M",
        name: "Medium",
        priceMinor: 4500,
        currency: "USD",
        attributesJson: null,
        stockStatus: "IN_STOCK",
      }),
    ).toThrow();
  });
});

describe("publicProductDetailSchema", () => {
  it("accepts a well-formed product detail with its variants", () => {
    const detail = {
      id: "01977e6a-0000-7000-8000-000000000000",
      mode: "PRODUCT" as const,
      name: "Wool Sweater",
      slug: "wool-sweater",
      description: null,
      variants: [
        {
          id: "01977e6a-0000-7000-8000-000000000002",
          sku: "SWEATER-M",
          name: "Medium",
          priceMinor: 4500,
          currency: "USD",
          attributesJson: null,
          stockStatus: "OUT_OF_STOCK" as const,
        },
      ],
    };
    expect(publicProductDetailSchema.parse(detail)).toEqual(detail);
  });

  it("rejects a payload carrying an internal merchantId", () => {
    expect(() =>
      publicProductDetailSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000000",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: "wool-sweater",
        description: null,
        variants: [],
      }),
    ).toThrow();
  });
});
