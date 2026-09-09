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
});
