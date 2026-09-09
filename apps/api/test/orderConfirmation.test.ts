import { describe, expect, it, vi } from "vitest";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import {
  CartService,
  ListingRepository,
  MerchantRepository,
  OrderRepository,
  UserRepository,
  VariantRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { buildApp } from "../src/app";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Base {
  connection: Connection;
  slug: string;
  orderId: string;
}

async function setupBase(withContactEmail = true): Promise<Base> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `merchant-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Merchant",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
    connectAccountId: "acct_test",
  });

  const users = new UserRepository(connection);
  const customerUserId = users.create({ email: "customer@example.com", status: "ACTIVE", createdAt: CREATED_AT });

  const listingRepo = new ListingRepository(connection);
  const variantRepo = new VariantRepository(connection);
  const orderRepo = new OrderRepository(connection);
  const cartService = new CartService(orderRepo, variantRepo);

  const listingId = listingRepo.create(ctx, {
    mode: "PRODUCT",
    name: "A Listing",
    slug: "a-listing",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variantRepo.create(ctx, {
    listingId,
    mode: "PRODUCT",
    sku: "A-SKU",
    name: "A Variant",
    priceMinor: 10_000,
    currency: "USD",
  });

  const cartId = cartService.createCart(ctx, { customerUserId, currency: "USD" });
  cartService.addProductLine(ctx, { cartId, variantId, quantity: 1 });

  if (withContactEmail) {
    orderRepo.updateContactDetails(ctx, cartId, {
      contactName: "Jamie Customer",
      contactEmail: "jamie@example.com",
    });
  }

  return { connection, slug, orderId: cartId };
}

describe("POST /v1/m/:slug/checkout/:orderId/confirmation", () => {
  it("D131 acceptance criteria: itemizes charges, no card data anywhere in the response", async () => {
    const { connection, slug, orderId } = await setupBase();
    const app = buildApp({ connection });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${orderId}/confirmation`,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { orderId: string; totalMinor: number; lineItems: unknown[] };
    expect(body.orderId).toBe(orderId);
    expect(body.totalMinor).toBe(10_000);
    expect(body.lineItems).toHaveLength(1);
    expect(response.body).not.toMatch(/card|cvc|pan|expiry/i);
  });

  it("fires the injected receipt-email notifier when the order has a contact email", async () => {
    const { connection, slug, orderId } = await setupBase();
    const onReceiptEmail = vi.fn();
    const app = buildApp({ connection, onReceiptEmail });

    await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${orderId}/confirmation`,
    });

    expect(onReceiptEmail).toHaveBeenCalledTimes(1);
    expect(onReceiptEmail.mock.calls[0]?.[0]).toMatchObject({ contactEmail: "jamie@example.com" });
  });

  it("does not fire the notifier when the order has no contact email on file", async () => {
    const { connection, slug, orderId } = await setupBase(false);
    const onReceiptEmail = vi.fn();
    const app = buildApp({ connection, onReceiptEmail });

    await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${orderId}/confirmation`,
    });

    expect(onReceiptEmail).not.toHaveBeenCalled();
  });

  it("404s for an unknown merchant slug", async () => {
    const { connection, orderId } = await setupBase();
    const app = buildApp({ connection });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/does-not-exist/checkout/${orderId}/confirmation`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404s for an unknown order id", async () => {
    const { connection, slug } = await setupBase();
    const app = buildApp({ connection });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${generateUuidV7()}/confirmation`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("is rate-limited per IP", async () => {
    const { connection, slug, orderId } = await setupBase();
    const app = buildApp({ connection, publicCheckoutRateLimit: { limit: 1, windowMs: 60_000 } });

    await app.inject({ method: "POST", url: `/v1/m/${slug}/checkout/${orderId}/confirmation` });
    const second = await app.inject({ method: "POST", url: `/v1/m/${slug}/checkout/${orderId}/confirmation` });

    expect(second.statusCode).toBe(429);
  });
});
