import { expect, test } from "@playwright/test";
import { generateUuidV7 } from "@smb-os/domain";
import { seedMerchant, seedProductCart, seedProductListing } from "../fixtures/seed";

const API_BASE_URL = process.env.E2E_API_BASE_URL!;

/**
 * Critical flow 1/5 — a customer browses a PRODUCT listing, pays for a
 * cart order (real HTTP through `apps/api/src/routes/checkoutPayment.ts`,
 * real browser interaction against `PaymentView.tsx`), and lands on an
 * itemized order confirmation. Card/cart seeding rationale: see
 * `../fixtures/seed.ts`'s module doc comment.
 */
test("browse a product, pay, and see an itemized confirmation", async ({ page }) => {
  const merchant = await seedMerchant();
  const product = await seedProductListing(merchant);

  await page.goto(`/m/${merchant.slug}`);
  await expect(page.getByRole("link", { name: "E2E Widget" })).toBeVisible();

  await page.getByRole("link", { name: "E2E Widget" }).click();
  await expect(page.getByText("In stock")).toBeVisible();

  const customerUserId = generateUuidV7();
  const { orderId } = seedProductCart(merchant, product, customerUserId);

  await page.goto(`/m/${merchant.slug}/checkout?orderId=${orderId}`);
  const payButton = page.getByRole("button", { name: "Pay" });
  await expect(payButton).toBeEnabled();
  await payButton.click();

  await expect(page.getByRole("status")).toContainText("Payment completed");
  await expect(page.getByRole("status")).toContainText("25.00 USD");

  await page.getByRole("link", { name: "View order confirmation" }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/confirmation\\?orderId=${orderId}`));
  await expect(page.getByText(/PRODUCT/)).toBeVisible();
  await expect(page.getByText(/25\.00 USD/).first()).toBeVisible();

  // This card's security check for order confirmation (D131, still enforced
  // here): no card number/CVC/expiry ever rendered on the receipt.
  await expect(page.getByText(/card|cvc|pan|expiry/i)).toHaveCount(0);

  const receiptRes = await fetch(`${API_BASE_URL}/v1/m/${merchant.slug}/checkout/${orderId}/confirmation`, { method: "POST" });
  const receipt = (await receiptRes.json()) as { totalMinor: number; lineItems: { mode: string }[] };
  expect(receipt.totalMinor).toBe(2500);
  expect(receipt.lineItems).toHaveLength(1);
  expect(receipt.lineItems[0]!.mode).toBe("PRODUCT");
});
