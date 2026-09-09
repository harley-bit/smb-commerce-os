import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  MerchantRepository,
  MerchantUserRepository,
  UserRepository,
  ListingRepository,
  ListingService,
  OrderRepository,
  VariantRepository,
  VariantService,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  otherMerchantId: string;
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

  const otherCtx = createTenantContext(generateUuidV7());
  merchants.create(otherCtx, {
    name: "other-co",
    slug: `other-co-${generateUuidV7()}`,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });
  const otherMerchantId = otherCtx.merchantId;

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
    otherMerchantId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

async function createProductListing(connection: Connection, merchantId: string): Promise<string> {
  const service = new ListingService(new ListingRepository(connection));
  return service.create(createTenantContext(merchantId), "OWNER", {
    mode: "PRODUCT",
    name: "Widget",
    slug: `widget-${generateUuidV7()}`,
    status: "DRAFT",
    createdAt: CREATED_AT,
  });
}

describe("variant endpoints", () => {
  describe("GET /listings/:listingId/variants — catalog:view (all roles)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])(
      "%s can list variants for a listing",
      async (role) => {
        const fx = await setupFixture(role);
        const listingId = await createProductListing(fx.connection, fx.merchantId);

        const res = await fx.app.inject({
          method: "GET",
          url: `/listings/${listingId}/variants`,
          headers: fx.merchantHeader,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([]);
      },
    );

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: { "x-merchant-id": fx.merchantId },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /listings/:listingId/variants — catalog:manage (OWNER/ADMIN only)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can create a variant", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "WIDGET-RED", name: "Widget — Red", priceMinor: 1999, currency: "USD" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };
      expect(body.id).toBeTruthy();

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
      });
      expect((listRes.json() as unknown[]).length).toBe(1);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from creating a variant", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "WIDGET-RED", name: "Widget — Red", priceMinor: 1999, currency: "USD" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects an invalid payload with 400", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "", name: "Widget — Red", priceMinor: 1999, currency: "USD" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("ignores a client-supplied mode/listingId and forces them from the parent listing", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: {
          sku: "WIDGET-RED",
          name: "Widget — Red",
          priceMinor: 1999,
          currency: "USD",
          mode: "RENTAL",
          listingId: "some-other-listing-id",
          depositMinor: 500,
        },
      });
      // depositMinor is rental-only; forcing mode to PRODUCT (the parent listing's real mode)
      // must reject it, proving the client-supplied mode was never trusted.
      expect(res.statusCode).toBe(400);
    });

    it("rejects a variant for a listing owned by another merchant with 404, not 200 or 403", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.otherMerchantId);
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "WIDGET-RED", name: "Widget — Red", priceMinor: 1999, currency: "USD" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s for a nonexistent listing", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${generateUuidV7()}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "WIDGET-RED", name: "Widget — Red", priceMinor: 1999, currency: "USD" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /listings/:listingId/variants/:variantId — catalog:manage (OWNER/ADMIN only)", () => {
    async function createVariant(
      connection: Connection,
      merchantId: string,
      listingId: string,
      overrides: Partial<{ sku: string; name: string; priceMinor: number; currency: string }> = {},
    ): Promise<string> {
      const service = new VariantService(new VariantRepository(connection));
      return service.create(createTenantContext(merchantId), "OWNER", {
        listingId,
        mode: "PRODUCT",
        sku: overrides.sku ?? "WIDGET-RED",
        name: overrides.name ?? "Widget — Red",
        priceMinor: overrides.priceMinor ?? 1999,
        currency: overrides.currency ?? "USD",
      });
    }

    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can bulk-edit variant price and attributes", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantAId = await createVariant(fx.connection, fx.merchantId, listingId, { sku: "A" });
      const variantBId = await createVariant(fx.connection, fx.merchantId, listingId, { sku: "B" });

      const resA = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantAId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 2499, attributesJson: JSON.stringify({ color: "red" }) },
      });
      const resB = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantBId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 3499 },
      });
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
      });
      const variants = listRes.json() as Array<{ id: string; priceMinor: number; attributesJson: string | null }>;
      expect(variants.find((v) => v.id === variantAId)?.priceMinor).toBe(2499);
      expect(variants.find((v) => v.id === variantAId)?.attributesJson).toBe(JSON.stringify({ color: "red" }));
      expect(variants.find((v) => v.id === variantBId)?.priceMinor).toBe(3499);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from editing a variant", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 2499 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects a non-integer price with 400 and leaves the stored price unchanged", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 19.99, currency: "USD" },
      });
      expect(res.statusCode).toBe(400);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
      });
      const variants = listRes.json() as Array<{ id: string; priceMinor: number }>;
      expect(variants.find((v) => v.id === variantId)?.priceMinor).toBe(1999);
    });

    it("rejects a client-supplied mode/listingId patch with 400 (.strict() schema)", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 2499, currency: "USD", mode: "RENTAL" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("404s for a variant belonging to another merchant's listing, not 403 or 200", async () => {
      const fx = await setupFixture("OWNER");
      const otherListingId = await createProductListing(fx.connection, fx.otherMerchantId);
      const otherVariantId = await createVariant(fx.connection, fx.otherMerchantId, otherListingId);
      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${otherListingId}/variants/${otherVariantId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 2499 },
      });
      expect(res.statusCode).toBe(404);
    });

    it("security check: repricing a variant does not alter a historical order line's price", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId, { priceMinor: 1999 });

      const ctx = createTenantContext(fx.merchantId);
      const customerUserId = new UserRepository(fx.connection).create({
        email: "customer@example.com",
        status: "ACTIVE",
        createdAt: CREATED_AT,
      });
      const orders = new OrderRepository(fx.connection);
      const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
      const lineId = orders.addLine(ctx, orderId, {
        listingId,
        variantId,
        mode: "PRODUCT",
        quantity: 1,
        unitPriceMinor: 1999,
        lineTotalMinor: 1999,
      });

      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}`,
        headers: fx.merchantHeader,
        payload: { priceMinor: 9999 },
      });
      expect(res.statusCode).toBe(200);

      const lines = orders.listLines(ctx, orderId);
      const historicalLine = lines.find((line) => line.id === lineId);
      expect(historicalLine?.unitPriceMinor).toBe(1999);
      expect(historicalLine?.lineTotalMinor).toBe(1999);
    });
  });
});
