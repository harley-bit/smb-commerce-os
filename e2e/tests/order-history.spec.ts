import { expect, test } from "@playwright/test";
import { attachSession, registerCustomer } from "../fixtures/auth";
import { seedMerchant, seedServiceCart, seedServiceListing } from "../fixtures/seed";

const API_BASE_URL = process.env.E2E_API_BASE_URL!;

/**
 * Critical flow 4/5 — a signed-in customer views their own order history
 * (D132), split into upcoming/past, and never sees an order that isn't
 * theirs (this card's IDOR defense — proven here as a real 404 over real
 * HTTP against a real browser session, not just a service-layer unit
 * test). Auth rationale: see `../fixtures/auth.ts`'s module doc comment.
 */
test("a signed-in customer sees their own upcoming order, and a stranger's order id 404s", async ({ page, request, context }) => {
  const merchant = await seedMerchant();
  const service = await seedServiceListing(merchant);

  const customer = await registerCustomer(request, API_BASE_URL);
  const stranger = await registerCustomer(request, API_BASE_URL);
  await attachSession(context, customer, "127.0.0.1");

  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();
  const { orderId } = seedServiceCart(merchant, service, customer.userId, future, futureEnd);
  const strangersOrder = seedServiceCart(merchant, service, stranger.userId, future, futureEnd);

  await page.goto(`/m/${merchant.slug}/account/orders`);
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
  await expect(page.getByText(/45\.00 USD — CART — SERVICE/)).toBeVisible();

  const ownDetailRes = await request.get(`${API_BASE_URL}/v1/m/${merchant.slug}/account/orders/${orderId}`, {
    headers: { cookie: `session=${customer.sessionToken}` },
  });
  expect(ownDetailRes.status()).toBe(200);

  const strangersDetailRes = await request.get(
    `${API_BASE_URL}/v1/m/${merchant.slug}/account/orders/${strangersOrder.orderId}`,
    { headers: { cookie: `session=${customer.sessionToken}` } },
  );
  expect(strangersDetailRes.status()).toBe(404);
});
