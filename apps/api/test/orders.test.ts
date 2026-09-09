import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  ListingRepository,
  MerchantRepository,
  MerchantUserRepository,
  OrderRepository,
  UserRepository,
  VariantRepository,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  userId: string;
  merchantHeader: Record<string, string>;
  app: FastifyInstance;
}

async function setupFixture(role: MerchantUserRole): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  merchants.create(ctx, {
    name: "acme",
    slug: `acme-${generateUuidV7()}`,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });
  const merchantId = ctx.merchantId;

  const dbUsers = new UserRepository(connection);
  const userId = dbUsers.create({ email: "user@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(connection);
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);

  const identity: AuthIdentity = { userId, email: "user@example.com", roles: [role] };
  const fakeAuthProvider: AuthProvider = {
    register: () => Promise.reject(new Error("not implemented")),
    authenticate: () => Promise.reject(new Error("not implemented")),
    createSession: () => Promise.reject(new Error("not implemented")),
    verifySession: (token) => Promise.resolve(token === "valid-token" ? identity : null),
    revokeSession: () => Promise.resolve(),
    initiatePasswordReset: () => Promise.resolve(),
    completePasswordReset: () => Promise.reject(new Error("not implemented")),
    enrollMfa: () => Promise.reject(new Error("not implemented")),
    confirmMfaEnrollment: () => Promise.reject(new Error("not implemented")),
  };

  const app = buildApp({
    authProvider: fakeAuthProvider,
    merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    connection,
  });

  return {
    connection,
    merchantId,
    userId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

async function seedMixedOrder(connection: Connection, merchantId: string, customerUserId: string): Promise<string> {
  const ctx = createTenantContext(merchantId);
  const listings = new ListingRepository(connection);
  const variants = new VariantRepository(connection);
  const orders = new OrderRepository(connection);

  const productListingId = listings.create(ctx, {
    mode: "PRODUCT",
    name: "Mug",
    slug: `mug-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const productVariantId = variants.create(ctx, {
    listingId: productListingId,
    mode: "PRODUCT",
    sku: `MUG-${generateUuidV7()}`,
    name: "Mug",
    priceMinor: 1200,
    currency: "USD",
  });

  const serviceListingId = listings.create(ctx, {
    mode: "SERVICE",
    name: "Haircut",
    slug: `haircut-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const serviceVariantId = variants.create(ctx, {
    listingId: serviceListingId,
    mode: "SERVICE",
    sku: `CUT-${generateUuidV7()}`,
    name: "Haircut",
    priceMinor: 4500,
    currency: "USD",
    durationMinutes: 30,
  });

  const rentalListingId = listings.create(ctx, {
    mode: "RENTAL",
    name: "Kayak",
    slug: `kayak-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const rentalVariantId = variants.create(ctx, {
    listingId: rentalListingId,
    mode: "RENTAL",
    sku: `KAYAK-${generateUuidV7()}`,
    name: "Single kayak",
    priceMinor: 5000,
    currency: "USD",
    bufferMinutes: 0,
  });

  const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
  orders.addLine(ctx, orderId, {
    listingId: productListingId,
    variantId: productVariantId,
    mode: "PRODUCT",
    quantity: 2,
    unitPriceMinor: 1200,
    lineTotalMinor: 2400,
  });
  orders.addLine(ctx, orderId, {
    listingId: serviceListingId,
    variantId: serviceVariantId,
    mode: "SERVICE",
    quantity: 1,
    unitPriceMinor: 4500,
    lineTotalMinor: 4500,
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T09:30:00.000Z",
  });
  orders.addLine(ctx, orderId, {
    listingId: rentalListingId,
    variantId: rentalVariantId,
    mode: "RENTAL",
    quantity: 1,
    unitPriceMinor: 5000,
    lineTotalMinor: 5000,
    startsAt: "2026-10-02T09:00:00.000Z",
    endsAt: "2026-10-03T09:00:00.000Z",
  });
  orders.updateTotals(ctx, orderId, { subtotalMinor: 11900, taxMinor: 0, totalMinor: 11900 });

  return orderId;
}

describe("GET /orders and GET /orders/:orderId — order list and detail", () => {
  it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])(
    "%s can list orders and see all three modes represented",
    async (role) => {
      const fx = await setupFixture(role);
      const orderId = await seedMixedOrder(fx.connection, fx.merchantId, fx.userId);

      const listRes = await fx.app.inject({ method: "GET", url: "/orders", headers: fx.merchantHeader });
      expect(listRes.statusCode).toBe(200);
      const summaries = listRes.json() as Array<{ id: string; modes: string[] }>;
      expect(summaries).toHaveLength(1);
      expect(new Set(summaries[0]!.modes)).toEqual(new Set(["PRODUCT", "SERVICE", "RENTAL"]));

      const detailRes = await fx.app.inject({
        method: "GET",
        url: `/orders/${orderId}`,
        headers: fx.merchantHeader,
      });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json() as { lines: Array<{ mode: string; listingName: string }> };
      expect(detail.lines).toHaveLength(3);
      const byMode = new Map(detail.lines.map((line) => [line.mode, line.listingName]));
      expect(byMode.get("PRODUCT")).toBe("Mug");
      expect(byMode.get("SERVICE")).toBe("Haircut");
      expect(byMode.get("RENTAL")).toBe("Kayak");
    },
  );

  it("404s on a detail request for an order id that does not exist", async () => {
    const fx = await setupFixture("OWNER");
    const res = await fx.app.inject({
      method: "GET",
      url: `/orders/${generateUuidV7()}`,
      headers: fx.merchantHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an unauthenticated request to either route", async () => {
    const fx = await setupFixture("OWNER");
    const listRes = await fx.app.inject({ method: "GET", url: "/orders" });
    expect(listRes.statusCode).toBe(401);

    const detailRes = await fx.app.inject({ method: "GET", url: `/orders/${generateUuidV7()}` });
    expect(detailRes.statusCode).toBe(401);
  });

  it("is tenant-scoped — merchant B never sees merchant A's orders", async () => {
    const fxA = await setupFixture("OWNER");
    const fxB = await setupFixture("OWNER");
    const orderId = await seedMixedOrder(fxA.connection, fxA.merchantId, fxA.userId);

    const listRes = await fxB.app.inject({ method: "GET", url: "/orders", headers: fxB.merchantHeader });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([]);

    const detailRes = await fxB.app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: fxB.merchantHeader,
    });
    expect(detailRes.statusCode).toBe(404);
  });

  it("this card's security check: no route other than GET exists for /orders — READ_ONLY (or any role) cannot mutate through this feature", async () => {
    const fx = await setupFixture("READ_ONLY");
    const orderId = await seedMixedOrder(fx.connection, fx.merchantId, fx.userId);

    const putRes = await fx.app.inject({
      method: "PUT",
      url: `/orders/${orderId}`,
      headers: fx.merchantHeader,
      payload: { status: "CANCELLED" },
    });
    expect(putRes.statusCode).toBe(404);

    const deleteRes = await fx.app.inject({
      method: "DELETE",
      url: `/orders/${orderId}`,
      headers: fx.merchantHeader,
    });
    expect(deleteRes.statusCode).toBe(404);
  });
});
