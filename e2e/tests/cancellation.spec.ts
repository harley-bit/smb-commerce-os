import { expect, test } from "@playwright/test";
import { attachSession, registerCustomer } from "../fixtures/auth";
import { seedMerchant, seedServiceCart, seedServiceListing } from "../fixtures/seed";

const API_BASE_URL = process.env.E2E_API_BASE_URL!;

/**
 * Critical flow 5/5 — a customer cancels their own upcoming order from
 * the real order-history page (D133's cancellation service, wired to the
 * new "Cancel" button this card added to `OrderHistoryView.tsx` — no
 * cancellation UI existed anywhere before this card; D133's own log
 * scoped its acceptance criteria to the service/HTTP layers only). A
 * "pilot-capable" storefront needs a customer to be able to actually
 * cancel through the product, not just through a raw HTTP call — this
 * spec is what makes that claim true, not just documented.
 */
test("a customer cancels an upcoming order from their order history, and it shows CANCELLED without a reload", async ({
  page,
  request,
  context,
}) => {
  const merchant = await seedMerchant();
  const service = await seedServiceListing(merchant);
  const customer = await registerCustomer(request, API_BASE_URL);
  await attachSession(context, customer, "127.0.0.1");

  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();
  seedServiceCart(merchant, service, customer.userId, future, futureEnd);

  await page.goto(`/m/${merchant.slug}/account/orders`);
  await expect(page.getByText(/45\.00 USD — CART — SERVICE/)).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText(/45\.00 USD — CANCELLED — SERVICE/)).toBeVisible();
  // Cancelling once more is a no-op the button itself now prevents —
  // it only ever renders next to a non-CANCELLED order (D133's
  // `OrderAlreadyFinalizedError` guard is the server-side twin of this).
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
});
