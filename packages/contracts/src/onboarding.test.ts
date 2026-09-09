import { describe, expect, it } from "vitest";
import { onboardMerchantInputSchema } from "./onboarding.js";

const validInput = {
  businessName: "Acme Rentals",
  defaultCurrency: "USD",
  legalName: "Acme Rentals LLC",
  taxId: "12-3456789",
  businessAddress: {
    addressLine1: "1 Main St",
    city: "Springfield",
    postalCode: "62701",
    country: "US",
  },
  location: {
    name: "Downtown Storefront",
    timezone: "America/Chicago",
  },
};

describe("onboardMerchantInputSchema", () => {
  it("accepts a well-formed onboarding payload", () => {
    expect(onboardMerchantInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects a missing legalName — seller identity is required at onboarding (DAC7/DSA readiness)", () => {
    expect(() => onboardMerchantInputSchema.parse({ ...validInput, legalName: undefined })).toThrow();
  });

  it("rejects a missing taxId — seller identity is required at onboarding (DAC7/DSA readiness)", () => {
    expect(() => onboardMerchantInputSchema.parse({ ...validInput, taxId: undefined })).toThrow();
  });

  it("rejects a missing business address", () => {
    expect(() => onboardMerchantInputSchema.parse({ ...validInput, businessAddress: undefined })).toThrow();
  });

  it("rejects a missing location", () => {
    expect(() => onboardMerchantInputSchema.parse({ ...validInput, location: undefined })).toThrow();
  });
});
