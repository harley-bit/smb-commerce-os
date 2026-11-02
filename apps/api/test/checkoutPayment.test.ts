import { describe, expect, it } from "vitest";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import {
  CartService,
  ListingRepository,
  MerchantRepository,
  OrderRepository,
  SimulatedPaymentIntentProvider,
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
  cartId: string;
  provider: SimulatedPaymentIntentProvider;
}

async function setupBase(withConnectAccount = true): Promise<Base> {
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
    ...(withConnectAccount ? { connectAccountId: "acct_test" } : {}),
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

  const provider = new SimulatedPaymentIntentProvider();
  return { connection, slug, cartId, provider };
}

describe("POST /v1/m/:slug/checkout/:orderId/payment-intent", () => {
  it("D130 acceptance criteria: creates a PaymentIntent for a CART order, no card data ever accepted by this route", async () => {
    const { connection, slug, cartId, provider } = await setupBase();
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-1" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { clientSecret: string; amountMinor: number; currency: string };
    expect(body.clientSecret).toBeTruthy();
    expect(body.amountMinor).toBe(10_000);
    expect(body.currency).toBe("USD");
  });

  it("rejects a request with no Idempotency-Key header", async () => {
    const { connection, slug, cartId, provider } = await setupBase();
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
    });

    expect(response.statusCode).toBe(400);
  });

  it("404s for an unknown merchant slug", async () => {
    const { connection, cartId, provider } = await setupBase();
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/does-not-exist/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-1" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("409s when the merchant has not completed payments setup (no connected account)", async () => {
    const { connection, slug, cartId, provider } = await setupBase(false);
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-1" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("404s for an unknown order id", async () => {
    const { connection, slug, provider } = await setupBase();
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${generateUuidV7()}/payment-intent`,
      headers: { "idempotency-key": "idem-1" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("402s and reports a generic customer message when the provider declines the charge, never the raw decline code", async () => {
    const { connection, slug, cartId, provider } = await setupBase();
    provider.simulateDeclineForOrder(cartId, "fraud_suspected");
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-1" },
    });

    expect(response.statusCode).toBe(402);
    const body = response.json() as { detail: string; retryableWithSameMethod: boolean };
    expect(body.detail).not.toMatch(/fraud/i);
    expect(body.retryableWithSameMethod).toBe(false);
  });

  it("a replayed Idempotency-Key returns the original intent rather than minting a second one", async () => {
    const { connection, slug, cartId, provider } = await setupBase();
    const app = buildApp({ connection, paymentIntentProvider: provider });

    const first = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-same" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/checkout/${cartId}/payment-intent`,
      headers: { "idempotency-key": "idem-same" },
    });

    expect(first.json().intentId).toBe(second.json().intentId);
    expect(provider.intentCount()).toBe(1);
  });
});
