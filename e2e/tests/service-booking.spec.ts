import { expect, test } from "@playwright/test";
import { generateUuidV7 } from "@smb-os/domain";
import { seedMerchant, seedServiceCart, seedServiceListing } from "../fixtures/seed";

/**
 * Critical flow 2/5 — a customer browses a SERVICE listing, interacts
 * with the real free/busy slot picker (D123/D125), then pays for and
 * confirms a booking. Booking rationale: see `../fixtures/seed.ts`'s
 * module doc comment (the slot picker has no cart-add wiring yet — this
 * spec both proves the picker itself works against real server
 * availability, and independently seeds the priced order it then pays).
 */
test("browse a service, pick a free slot, pay, and see it on the receipt", async ({ page }) => {
  const merchant = await seedMerchant();
  const service = await seedServiceListing(merchant);

  await page.goto(`/m/${merchant.slug}/l/${service.listingSlug}`);
  await expect(page.getByRole("heading", { name: "E2E Haircut" })).toBeVisible();

  const firstSlot = page.getByRole("button", { name: /UTC$/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await expect(firstSlot).toHaveAttribute("aria-pressed", "true");

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const startsAt = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 10, 0)).toISOString();
  const endsAt = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 11, 0)).toISOString();
  const customerUserId = generateUuidV7();
  const { orderId } = seedServiceCart(merchant, service, customerUserId, startsAt, endsAt);

  await page.goto(`/m/${merchant.slug}/checkout?orderId=${orderId}`);
  await expect(page.getByRole("button", { name: "Pay" })).toBeEnabled();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("status")).toContainText("Payment completed");

  await page.getByRole("link", { name: "View order confirmation" }).click();
  await expect(page.getByText(/SERVICE/)).toBeVisible();
  await expect(page.getByText(/45\.00 USD/).first()).toBeVisible();
});
