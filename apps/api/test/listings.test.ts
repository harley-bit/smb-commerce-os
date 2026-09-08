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
  sessionCookie: string;
  merchantHeader: Record<string, string>;
  otherMerchantHeader: Record<string, string>;
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
  // Not a member of otherMerchantId at all — used for the cross-tenant/IDOR case.

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
    sessionCookie: "session=valid-token",
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    otherMerchantHeader: { cookie: "session=valid-token", "x-merchant-id": otherMerchantId },
    app,
  };
}

async function createListing(connection: Connection, merchantId: string): Promise<string> {
  const service = new ListingService(new ListingRepository(connection));
  return service.create(createTenantContext(merchantId), "OWNER", {
    mode: "PRODUCT",
    name: "Widget",
    slug: `widget-${generateUuidV7()}`,
    status: "DRAFT",
    createdAt: CREATED_AT,
  });
}

describe("listing endpoints", () => {
  describe("GET /listings and GET /listings/:id — catalog:view (all roles)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])(
      "%s can list and read listings",
      async (role) => {
        const fx = await setupFixture(role);
        const listingId = await createListing(fx.connection, fx.merchantId);

        const listRes = await fx.app.inject({ method: "GET", url: "/listings", headers: fx.merchantHeader });
        expect(listRes.statusCode).toBe(200);
        expect((listRes.json() as unknown[]).length).toBe(1);

        const getRes = await fx.app.inject({ method: "GET", url: `/listings/${listingId}`, headers: fx.merchantHeader });
        expect(getRes.statusCode).toBe(200);
      },
    );

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({ method: "GET", url: "/listings", headers: { "x-merchant-id": fx.merchantId } });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /listings — catalog:manage (OWNER/ADMIN only)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can create a listing", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({
        method: "POST",
        url: "/listings",
        headers: fx.merchantHeader,
        payload: { mode: "PRODUCT", name: "Widget", slug: `widget-${generateUuidV7()}`, status: "DRAFT", createdAt: CREATED_AT },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { id: string }).id).toBeTruthy();
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from creating a listing", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({
        method: "POST",
        url: "/listings",
        headers: fx.merchantHeader,
        payload: { mode: "PRODUCT", name: "Widget", slug: `widget-${generateUuidV7()}`, status: "DRAFT", createdAt: CREATED_AT },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects an invalid payload with 400", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: "/listings",
        headers: fx.merchantHeader,
        payload: { mode: "NOT_A_MODE", name: "", slug: "widget" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /listings/:id — catalog:manage (OWNER/ADMIN only)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can update a listing", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "PATCH",
        url: `/listings/${listingId}`,
        headers: fx.merchantHeader,
        payload: { name: "Renamed Widget" },
      });
      expect(res.statusCode).toBe(200);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from updating a listing", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "PATCH",
        url: `/listings/${listingId}`,
        headers: fx.merchantHeader,
        payload: { name: "Renamed Widget" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects a patch carrying a mode key with 400 (mode immutability)", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({
        method: "PATCH",
        url: `/listings/${listingId}`,
        headers: fx.merchantHeader,
        payload: { mode: "SERVICE" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /listings/:id/archive — catalog:manage (OWNER/ADMIN only)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can archive a listing", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({ method: "POST", url: `/listings/${listingId}/archive`, headers: fx.merchantHeader });
      expect(res.statusCode).toBe(200);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from archiving a listing", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createListing(fx.connection, fx.merchantId);
      const res = await fx.app.inject({ method: "POST", url: `/listings/${listingId}/archive`, headers: fx.merchantHeader });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("cross-tenant isolation (IDOR)", () => {
    it("a listing created by another merchant is not readable — returns 404, not 200 or 403", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createListing(fx.connection, fx.otherMerchantId);

      const res = await fx.app.inject({ method: "GET", url: `/listings/${listingId}`, headers: fx.merchantHeader });
      expect(res.statusCode).toBe(404);
    });

    it("another merchant's listing does not appear in this merchant's list", async () => {
      const fx = await setupFixture("OWNER");
      await createListing(fx.connection, fx.otherMerchantId);

      const res = await fx.app.inject({ method: "GET", url: "/listings", headers: fx.merchantHeader });
      expect(res.statusCode).toBe(200);
      expect((res.json() as unknown[]).length).toBe(0);
    });

    it("cannot update another merchant's listing — returns 404", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createListing(fx.connection, fx.otherMerchantId);

      const res = await fx.app.inject({
        method: "PATCH",
        url: `/listings/${listingId}`,
        headers: fx.merchantHeader,
        payload: { name: "Hijacked" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("cannot archive another merchant's listing — returns 404", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createListing(fx.connection, fx.otherMerchantId);

      const res = await fx.app.inject({ method: "POST", url: `/listings/${listingId}/archive`, headers: fx.merchantHeader });
      expect(res.statusCode).toBe(404);
    });
  });
});
