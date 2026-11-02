import { describe, expect, it } from "vitest";
import {
  createVariantInputSchema,
  updateVariantInputSchema,
  variantSchema,
} from "./variant.js";

const baseVariant = {
  id: "01977e6a-0000-7000-8000-000000000010",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  listingId: "01977e6a-0000-7000-8000-000000000000",
  mode: "PRODUCT" as const,
  sku: "SKU-1",
  name: "Small",
  attributesJson: null,
  priceMinor: 500,
  currency: "USD",
  durationMinutes: null,
  ratePeriod: null,
  depositMinor: null,
  bufferMinutes: null,
  archivedAt: null,
};

describe("variantSchema", () => {
  it("accepts a well-formed variant row", () => {
    expect(variantSchema.parse(baseVariant)).toEqual(baseVariant);
  });
});

describe("createVariantInputSchema — price is validated through the shared Money rule", () => {
  it("accepts an integer priceMinor with a non-empty currency", () => {
    const input = {
      listingId: baseVariant.listingId,
      mode: "PRODUCT" as const,
      sku: "SKU-1",
      name: "Small",
      priceMinor: 500,
      currency: "USD",
    };
    expect(createVariantInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a non-integer priceMinor — the same rule Money.of enforces server-side", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 5.5,
        currency: "USD",
      }),
    ).toThrow();
  });

  it("rejects an empty currency code", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 500,
        currency: "",
      }),
    ).toThrow();
  });

  it("rejects a PRODUCT variant carrying durationMinutes", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 500,
        currency: "USD",
        durationMinutes: 30,
      }),
    ).toThrow();
  });

  it("rejects a SERVICE variant carrying depositMinor", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "SERVICE",
        sku: "SKU-2",
        name: "Consult",
        priceMinor: 500,
        currency: "USD",
        depositMinor: 100,
      }),
    ).toThrow();
  });

  it("rejects a RENTAL variant carrying durationMinutes", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "RENTAL",
        sku: "SKU-3",
        name: "Tent",
        priceMinor: 500,
        currency: "USD",
        durationMinutes: 60,
      }),
    ).toThrow();
  });

  it("accepts a SERVICE variant with durationMinutes and no rental-only fields", () => {
    const input = {
      listingId: baseVariant.listingId,
      mode: "SERVICE" as const,
      sku: "SKU-2",
      name: "Consult",
      priceMinor: 500,
      currency: "USD",
      durationMinutes: 45,
    };
    expect(createVariantInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a RENTAL variant with ratePeriod, depositMinor, and bufferMinutes", () => {
    const input = {
      listingId: baseVariant.listingId,
      mode: "RENTAL" as const,
      sku: "SKU-3",
      name: "Tent",
      priceMinor: 500,
      currency: "USD",
      ratePeriod: "DAY" as const,
      depositMinor: 2000,
      bufferMinutes: 30,
    };
    expect(createVariantInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a PRODUCT variant carrying bufferMinutes", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 500,
        currency: "USD",
        bufferMinutes: 15,
      }),
    ).toThrow();
  });

  it("rejects a SERVICE variant carrying bufferMinutes", () => {
    expect(() =>
      createVariantInputSchema.parse({
        listingId: baseVariant.listingId,
        mode: "SERVICE",
        sku: "SKU-2",
        name: "Consult",
        priceMinor: 500,
        currency: "USD",
        bufferMinutes: 15,
      }),
    ).toThrow();
  });
});

describe("updateVariantInputSchema", () => {
  it("accepts a partial price-only patch validated through the same Money rule", () => {
    expect(updateVariantInputSchema.parse({ priceMinor: 600, currency: "USD" })).toEqual({
      priceMinor: 600,
      currency: "USD",
    });
  });

  it("rejects a non-integer priceMinor patch", () => {
    expect(() => updateVariantInputSchema.parse({ priceMinor: 6.1, currency: "USD" })).toThrow();
  });

  it("accepts an empty patch", () => {
    expect(updateVariantInputSchema.parse({})).toEqual({});
  });

  it("skips money validation when only one of priceMinor/currency is patched", () => {
    expect(updateVariantInputSchema.parse({ priceMinor: 600 })).toEqual({ priceMinor: 600 });
    expect(updateVariantInputSchema.parse({ currency: "USD" })).toEqual({ currency: "USD" });
  });

  it("has no mode or listingId field — both are fixed at creation", () => {
    expect(() =>
      updateVariantInputSchema.parse({ mode: "RENTAL", priceMinor: 600, currency: "USD" }),
    ).toThrow();
    expect(() =>
      updateVariantInputSchema.parse({ listingId: "x", priceMinor: 600, currency: "USD" }),
    ).toThrow();
  });
});
