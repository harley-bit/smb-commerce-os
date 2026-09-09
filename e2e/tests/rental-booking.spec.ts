import { expect, test } from "@playwright/test";
import { generateUuidV7 } from "@smb-os/domain";
import { seedMerchant, seedRentalCart, seedRentalListing } from "../fixtures/seed";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Critical flow 3/5 — a customer browses a RENTAL listing, sees the
 * deposit disclosed unconditionally before picking any date (D124's
 * security check), picks an available date range (real availability
 * check against the server), then pays and confirms — the receipt shows
 * the deposit hold, not just the rental fee. Cart-seeding rationale: see
 * `../fixtures/seed.ts`'s module doc comment.
 */
test("browse a rental, see the deposit disclosed, pick dates, pay, and see the deposit hold on the receipt", async ({ page }) => {
  const merchant = await seedMerchant();
  const rental = await seedRentalListing(merchant);

  await page.goto(`/m/${merchant.slug}/l/${rental.listingSlug}`);
  await expect(page.getByRole("heading", { name: "E2E Trailer" })).toBeVisible();
  // Deposit disclosure is present before any date is entered — D124's security check.
  await expect(page.getByText(/refundable deposit of 250\.00 USD/)).toBeVisible();

  const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await page.getByLabel("Start date").fill(isoDate(start));
  await page.getByLabel("End date").fill(isoDate(end));

  const reserveButton = page.getByRole("button", { name: /^Reserve/ });
  await expect(reserveButton).toBeVisible();
  await reserveButton.click();
  await expect(reserveButton).toHaveAttribute("aria-pressed", "true");

  const startsAt = `${isoDate(start)}T00:00:00.000Z`;
  const endsAt = `${isoDate(end)}T00:00:00.000Z`;
  const customerUserId = generateUuidV7();
  const { orderId } = seedRentalCart(merchant, rental, customerUserId, startsAt, endsAt);

  await page.goto(`/m/${merchant.slug}/checkout?orderId=${orderId}`);
  await expect(page.getByRole("button", { name: "Pay" })).toBeEnabled();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("status")).toContainText("Payment completed");

  await page.getByRole("link", { name: "View order confirmation" }).click();
  await expect(page.getByText(/RENTAL/)).toBeVisible();
  await expect(page.getByText(/Deposit holds/)).toBeVisible();
  await expect(page.getByText(/250\.00 USD/).first()).toBeVisible();
});
