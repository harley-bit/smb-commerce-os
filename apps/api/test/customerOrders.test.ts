import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  ListingRepository,
  MerchantRepository,
  OrderRepository,
  PaymentRepository,
  UserRepository,
  VariantRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { buildApp } from "../src/app";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  slug: string;
  customerUserId: string;
  otherCustomerUserId: string;
  app: FastifyInstance;
}

function fakeAuthProvider(identityByToken: Map<string, AuthIdentity>): AuthProvider {
  return {
    register: () => Promise.reject(new Error("not implemented")),
    authenticate: () => Promise.reject(new Error("not implemented")),
    createSession: () => Promise.reject(new Error("not implemented")),
    verifySession: (token) => Promise.resolve(identityByToken.get(token) ?? null),
    revokeSession: () => Promise.resolve(),
    initiatePasswordReset: () => Promise.resolve(),
    completePasswordReset: () => Promise.reject(new Error("not implemented")),
    enrollMfa: () => Promise.reject(new Error("not implemented")),
    confirmMfaEnrollment: () => Promise.reject(new Error("not implemented")),
    createAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    exchangeAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    refreshMobileSession: () => Promise.reject(new Error("not implemented")),
    revokeMobileSession: () => Promise.resolve(),
  };
}

async function setupFixture(): Promise<Fixture> {
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
  });

  const users = new UserRepository(connection);
  const customerUserId = users.create({ email: "customer@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const otherCustomerUserId = users.create({ email: "other@example.com", status: "ACTIVE", createdAt: CREATED_AT });

  const identityByToken = new Map<string, AuthIdentity>([
    ["customer-token", { userId: customerUserId, email: "customer@example.com", roles: [] }],
    ["other-token", { userId: otherCustomerUserId, email: "other@example.com", roles: [] }],
  ]);

  const app = buildApp({ authProvider: fakeAuthProvider(identityByToken), connection });

  return { connection, slug, customerUserId, otherCustomerUserId, app };
}

function seedProductOnlyOrder(connection: Connection, merchantId: string, customerUserId: string): string {
  const ctx = createTenantContext(merchantId);
  const listings = new ListingRepository(connection);
  const variants = new VariantRepository(connection);
  const orders = new OrderRepository(connection);

  const listingId = listings.create(ctx, {
    mode: "PRODUCT",
    name: "Mug",
    slug: `mug-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variants.create(ctx, {
    listingId,
    mode: "PRODUCT",
    sku: `MUG-${generateUuidV7()}`,
    name: "Mug",
    priceMinor: 1200,
    currency: "USD",
  });

  const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
  orders.addLine(ctx, orderId, {
    listingId,
    variantId,
    mode: "PRODUCT",
    quantity: 1,
    unitPriceMinor: 1200,
    lineTotalMinor: 1200,
  });
  orders.updateTotals(ctx, orderId, { subtotalMinor: 1200, taxMinor: 0, totalMinor: 1200 });
  return orderId;
}

function merchantIdForSlug(connection: Connection, slug: string): string {
  const merchants = new MerchantRepository(connection);
  return merchants.findBySlug(slug)!.id;
}

function chargeOrder(connection: Connection, merchantId: string, orderId: string): void {
  const ctx = createTenantContext(merchantId);
  new PaymentRepository(connection).create(ctx, {
    orderId,
    provider: "stripe",
    providerRef: "pi_original_charge",
    kind: "CHARGE",
    amountMinor: 1200,
    currency: "USD",
    status: "SUCCEEDED",
    createdAt: CREATED_AT,
  });
}

describe("GET /v1/m/:slug/account/orders and .../account/orders/:orderId", () => {
  it("this card's acceptance criteria: only the authenticated customer's orders are returned", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);
    seedProductOnlyOrder(fx.connection, merchantId, fx.otherCustomerUserId);

    const res = await fx.app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/account/orders`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { upcoming: unknown[]; past: Array<{ totalMinor: number }> };
    expect(body.upcoming).toEqual([]);
    expect(body.past).toHaveLength(1);
    expect(body.past[0]!.totalMinor).toBe(1200);
  });

  it("rejects an unauthenticated request to either route", async () => {
    const fx = await setupFixture();

    const listRes = await fx.app.inject({ method: "GET", url: `/v1/m/${fx.slug}/account/orders` });
    expect(listRes.statusCode).toBe(401);

    const detailRes = await fx.app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/account/orders/${generateUuidV7()}`,
    });
    expect(detailRes.statusCode).toBe(401);
  });

  it("404s when the merchant slug does not exist", async () => {
    const fx = await setupFixture();

    const res = await fx.app.inject({
      method: "GET",
      url: `/v1/m/no-such-merchant/account/orders`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns the order detail for the owning customer", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);

    const res = await fx.app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(200);
    const detail = res.json() as { id: string; lines: Array<{ listingName: string }> };
    expect(detail.id).toBe(orderId);
    expect(detail.lines[0]!.listingName).toBe("Mug");
  });

  it("this card's security check — IDOR: another customer's order id returns 404, not 403", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.otherCustomerUserId);

    const res = await fx.app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("404s on a detail request for an order id that does not exist at all — same status as the IDOR case", async () => {
    const fx = await setupFixture();

    const res = await fx.app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/account/orders/${generateUuidV7()}`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/m/:slug/account/orders/:orderId/cancel", () => {
  it("this card's acceptance criteria: cancels the order and issues the correct refund", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);
    chargeOrder(fx.connection, merchantId, orderId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { cookie: "session=customer-token", "idempotency-key": "cancel-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { orderId: string; lines: Array<{ refundPercent: number; refundAmountMinor: number }> };
    expect(body.orderId).toBe(orderId);
    expect(body.lines[0]).toMatchObject({ refundPercent: 100, refundAmountMinor: 1200 });

    const ctx = createTenantContext(merchantId);
    expect(new OrderRepository(fx.connection).findById(ctx, orderId)).toMatchObject({ status: "CANCELLED" });
  });

  it("this card's security check — cancellation authority verified against ownership: another customer's order returns 404, not 403, and is left untouched", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.otherCustomerUserId);
    chargeOrder(fx.connection, merchantId, orderId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { cookie: "session=customer-token", "idempotency-key": "cancel-2" },
    });

    expect(res.statusCode).toBe(404);
    const ctx = createTenantContext(merchantId);
    expect(new OrderRepository(fx.connection).findById(ctx, orderId)).toMatchObject({ status: "CONFIRMED" });
  });

  it("404s for an order id that does not exist at all — same status as the ownership-mismatch case", async () => {
    const fx = await setupFixture();

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${generateUuidV7()}/cancel`,
      headers: { cookie: "session=customer-token", "idempotency-key": "cancel-3" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects an unauthenticated cancellation request", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { "idempotency-key": "cancel-4" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("requires an Idempotency-Key header", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { cookie: "session=customer-token" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when cancelling an already-cancelled order", async () => {
    const fx = await setupFixture();
    const merchantId = merchantIdForSlug(fx.connection, fx.slug);
    const orderId = seedProductOnlyOrder(fx.connection, merchantId, fx.customerUserId);
    chargeOrder(fx.connection, merchantId, orderId);

    await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { cookie: "session=customer-token", "idempotency-key": "cancel-5" },
    });

    const res = await fx.app.inject({
      method: "POST",
      url: `/v1/m/${fx.slug}/account/orders/${orderId}/cancel`,
      headers: { cookie: "session=customer-token", "idempotency-key": "cancel-6" },
    });

    expect(res.statusCode).toBe(409);
  });
});
