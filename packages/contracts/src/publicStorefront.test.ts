import { describe, expect, it } from "vitest";
import {
  publicListingSchema,
  publicMerchantProfileSchema,
  publicProductDetailSchema,
  publicRentalDetailSchema,
  publicRentalVariantSchema,
  publicServiceDetailSchema,
  publicVariantSchema,
  rentalAvailabilityResponseSchema,
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

describe("publicServiceDetailSchema", () => {
  it("accepts a well-formed service detail with its resourceIds", () => {
    const detail = {
      id: "01977e6a-0000-7000-8000-000000000003",
      mode: "SERVICE" as const,
      name: "Haircut",
      slug: "haircut",
      description: null,
      resourceIds: ["01977e6a-0000-7000-8000-000000000004"],
    };
    expect(publicServiceDetailSchema.parse(detail)).toEqual(detail);
  });

  it("accepts an empty resourceIds array for a service with no resource assigned yet", () => {
    const detail = {
      id: "01977e6a-0000-7000-8000-000000000003",
      mode: "SERVICE" as const,
      name: "Haircut",
      slug: "haircut",
      description: null,
      resourceIds: [] as string[],
    };
    expect(publicServiceDetailSchema.parse(detail)).toEqual(detail);
  });

  it("rejects a payload carrying an internal merchantId", () => {
    expect(() =>
      publicServiceDetailSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000003",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        description: null,
        resourceIds: [],
      }),
    ).toThrow();
  });
});

describe("publicRentalVariantSchema", () => {
  it("accepts a well-formed rental variant carrying its deposit and rate period", () => {
    const variant = {
      id: "01977e6a-0000-7000-8000-000000000005",
      sku: "TENT-4P",
      name: "4-person tent",
      priceMinor: 3500,
      currency: "USD",
      ratePeriod: "DAY" as const,
      depositMinor: 15000,
    };
    expect(publicRentalVariantSchema.parse(variant)).toEqual(variant);
  });

  it("rejects a payload carrying an internal merchantId or listingId", () => {
    expect(() =>
      publicRentalVariantSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000005",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        listingId: "01977e6a-0000-7000-8000-000000000003",
        sku: "TENT-4P",
        name: "4-person tent",
        priceMinor: 3500,
        currency: "USD",
        ratePeriod: "DAY",
        depositMinor: 15000,
      }),
    ).toThrow();
  });

  it("rejects a payload carrying unit ids or a unit count — this card's security check", () => {
    expect(() =>
      publicRentalVariantSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000005",
        sku: "TENT-4P",
        name: "4-person tent",
        priceMinor: 3500,
        currency: "USD",
        ratePeriod: "DAY",
        depositMinor: 15000,
        unitsAvailable: 3,
      }),
    ).toThrow();
  });
});

describe("publicRentalDetailSchema", () => {
  it("accepts a well-formed rental detail with its variants", () => {
    const detail = {
      id: "01977e6a-0000-7000-8000-000000000006",
      mode: "RENTAL" as const,
      name: "Camping Tent",
      slug: "camping-tent",
      description: null,
      variants: [
        {
          id: "01977e6a-0000-7000-8000-000000000005",
          sku: "TENT-4P",
          name: "4-person tent",
          priceMinor: 3500,
          currency: "USD",
          ratePeriod: "DAY" as const,
          depositMinor: 15000,
        },
      ],
    };
    expect(publicRentalDetailSchema.parse(detail)).toEqual(detail);
  });

  it("rejects a payload carrying an internal merchantId", () => {
    expect(() =>
      publicRentalDetailSchema.strict().parse({
        id: "01977e6a-0000-7000-8000-000000000006",
        merchantId: "01977e6a-0000-7000-8000-000000000001",
        mode: "RENTAL",
        name: "Camping Tent",
        slug: "camping-tent",
        description: null,
        variants: [],
      }),
    ).toThrow();
  });
});

describe("rentalAvailabilityResponseSchema", () => {
  it("accepts a bare available boolean", () => {
    expect(rentalAvailabilityResponseSchema.parse({ available: true })).toEqual({ available: true });
    expect(rentalAvailabilityResponseSchema.parse({ available: false })).toEqual({ available: false });
  });

  it("rejects a payload carrying a unit id or reservation id — never who/what booked", () => {
    expect(() =>
      rentalAvailabilityResponseSchema.strict().parse({
        available: false,
        unitId: "01977e6a-0000-7000-8000-000000000007",
      }),
    ).toThrow();
  });
});
