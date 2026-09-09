import { describe, expect, it } from "vitest";
import { parseMerchantProfile } from "./parseMerchantProfile.js";

describe("parseMerchantProfile — mobile app shell wired to @smb-os/contracts", () => {
  it("accepts a well-formed public merchant profile", () => {
    const result = parseMerchantProfile({
      name: "Corner Bike Shop",
      slug: "corner-bike-shop",
      defaultCurrency: "USD",
    });

    expect(result).toEqual({
      ok: true,
      profile: { name: "Corner Bike Shop", slug: "corner-bike-shop", defaultCurrency: "USD" },
    });
  });

  it("rejects a payload that fails the shared publicMerchantProfileSchema", () => {
    const result = parseMerchantProfile({ name: "", slug: "corner-bike-shop" });

    expect(result.ok).toBe(false);
  });
});
