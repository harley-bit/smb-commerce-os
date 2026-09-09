import { describe, expect, it } from "vitest";
import { toWebPath } from "./routes.js";

describe("toWebPath — mobile screens mirror apps/web/src/app/m/[slug]'s route structure (D139)", () => {
  it("maps Home to the merchant page route", () => {
    expect(toWebPath({ name: "Home", params: { slug: "corner-bike-shop" } })).toBe("/m/corner-bike-shop");
  });

  it("maps ListingDetail to the listing route", () => {
    expect(
      toWebPath({ name: "ListingDetail", params: { slug: "corner-bike-shop", listingSlug: "trail-bike" } }),
    ).toBe("/m/corner-bike-shop/l/trail-bike");
  });

  it("maps Cart onto the checkout route — no dedicated web cart page exists yet (D145)", () => {
    expect(toWebPath({ name: "Cart", params: { slug: "corner-bike-shop" } })).toBe(
      "/m/corner-bike-shop/checkout",
    );
  });

  it("maps Checkout to the checkout route", () => {
    expect(toWebPath({ name: "Checkout", params: { slug: "corner-bike-shop" } })).toBe(
      "/m/corner-bike-shop/checkout",
    );
  });

  it("maps OrderConfirmation to the checkout confirmation route", () => {
    expect(
      toWebPath({ name: "OrderConfirmation", params: { slug: "corner-bike-shop", orderId: "ord_1" } }),
    ).toBe("/m/corner-bike-shop/checkout/confirmation");
  });

  it("maps AccountOrders to the account orders route", () => {
    expect(toWebPath({ name: "AccountOrders", params: { slug: "corner-bike-shop" } })).toBe(
      "/m/corner-bike-shop/account/orders",
    );
  });

  it("maps SignIn to the staff login route (no customer-storefront equivalent)", () => {
    expect(toWebPath({ name: "SignIn", params: {} })).toBe("/login");
  });
});
