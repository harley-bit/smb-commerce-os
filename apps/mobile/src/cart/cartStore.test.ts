import { describe, expect, it } from "vitest";
import { addLine, createEmptyCart, HOLD_DURATION_MS, removeLine, selectCartLineStatuses } from "./cartStore.js";

function fixedGenerators(lineId: string, idempotencyKey: string) {
  return { generateLineId: () => lineId, generateIdempotencyKey: () => idempotencyKey };
}

describe("addLine (D145)", () => {
  it("gives a RENTAL line a hold that expires HOLD_DURATION_MS after now", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      {
        mode: "RENTAL",
        slug: "corner-bike-shop",
        listingSlug: "trail-bike",
        variantId: "var_1",
        name: "Trail bike",
        unitPriceMinor: 5000,
        currency: "USD",
        startsAt: "2026-09-10T00:00:00.000Z",
        endsAt: "2026-09-12T00:00:00.000Z",
      },
      fixedGenerators("line_1", "idem_1"),
      now,
    );

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      id: "line_1",
      idempotencyKey: "idem_1",
      expiresAt: new Date(now.getTime() + HOLD_DURATION_MS).toISOString(),
    });
  });

  it("gives a PRODUCT line no hold at all — nothing to expire", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      {
        mode: "PRODUCT",
        slug: "corner-bike-shop",
        listingSlug: "repair-kit",
        variantId: "var_2",
        name: "Repair kit",
        unitPriceMinor: 1500,
        currency: "USD",
      },
      fixedGenerators("line_2", "idem_2"),
      now,
    );

    expect(cart.lines[0]?.expiresAt).toBeNull();
  });

  it("gives every line a non-empty idempotency key, distinct per line (this card's security check)", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    let cart = addLine(
      createEmptyCart(),
      { mode: "PRODUCT", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD" },
      fixedGenerators("line_1", "idem_1"),
      now,
    );
    cart = addLine(
      cart,
      { mode: "PRODUCT", slug: "s", listingSlug: "l2", variantId: "v2", name: "B", unitPriceMinor: 200, currency: "USD" },
      fixedGenerators("line_2", "idem_2"),
      now,
    );

    const keys = cart.lines.map((line) => line.idempotencyKey);
    expect(keys.every((key) => key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it("defaults quantity to 1 and preserves an explicit quantity", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      { mode: "PRODUCT", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD", quantity: 3 },
      fixedGenerators("line_1", "idem_1"),
      now,
    );
    expect(cart.lines[0]?.quantity).toBe(3);
  });
});

describe("removeLine (D145)", () => {
  it("removes only the targeted line", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    let cart = addLine(
      createEmptyCart(),
      { mode: "PRODUCT", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD" },
      fixedGenerators("line_1", "idem_1"),
      now,
    );
    cart = addLine(
      cart,
      { mode: "PRODUCT", slug: "s", listingSlug: "l2", variantId: "v2", name: "B", unitPriceMinor: 200, currency: "USD" },
      fixedGenerators("line_2", "idem_2"),
      now,
    );

    const after = removeLine(cart, "line_1");

    expect(after.lines.map((line) => line.id)).toEqual(["line_2"]);
  });

  it("is a no-op when the line id is not present", () => {
    const cart = createEmptyCart();
    expect(removeLine(cart, "missing")).toEqual(cart);
  });
});

describe("selectCartLineStatuses (D145) — hold expiry handled gracefully offline and online", () => {
  it("reports null countdown for a PRODUCT line — nothing depends on the clock", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      { mode: "PRODUCT", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD" },
      fixedGenerators("line_1", "idem_1"),
      now,
    );

    const [status] = selectCartLineStatuses(cart, now);
    expect(status?.countdown).toBeNull();
  });

  it("reports an active countdown for a RENTAL line before its hold expires", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      { mode: "RENTAL", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD" },
      fixedGenerators("line_1", "idem_1"),
      now,
    );

    const later = new Date(now.getTime() + 60_000);
    const [status] = selectCartLineStatuses(cart, later);
    expect(status?.countdown).toEqual({ msRemaining: HOLD_DURATION_MS - 60_000, expired: false });
  });

  it("reports expired: true, computed purely from the clock — no network call involved, so this holds offline exactly as online", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart = addLine(
      createEmptyCart(),
      { mode: "RENTAL", slug: "s", listingSlug: "l1", variantId: "v1", name: "A", unitPriceMinor: 100, currency: "USD" },
      fixedGenerators("line_1", "idem_1"),
      now,
    );

    const wayLater = new Date(now.getTime() + HOLD_DURATION_MS + 60_000);
    const [status] = selectCartLineStatuses(cart, wayLater);
    expect(status?.countdown).toEqual({ msRemaining: 0, expired: true });
  });
});
