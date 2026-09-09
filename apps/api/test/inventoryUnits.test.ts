import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  AuditLogRepository,
  MerchantRepository,
  MerchantUserRepository,
  UserRepository,
  InventoryUnitRepository,
  InventoryUnitService,
  ListingRepository,
  ListingService,
  LocationRepository,
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

async function createVariant(connection: Connection, merchantId: string, listingId: string): Promise<string> {
  const service = new VariantService(new VariantRepository(connection));
  return service.create(createTenantContext(merchantId), "OWNER", {
    listingId,
    mode: "PRODUCT",
    sku: "WIDGET-RED",
    name: "Widget — Red",
    priceMinor: 1999,
    currency: "USD",
  });
}

async function createLocation(connection: Connection, merchantId: string): Promise<string> {
  const repo = new LocationRepository(connection);
  return repo.create(createTenantContext(merchantId), { name: "Main", timezone: "America/New_York" });
}

const validUnitPayload = (locationId: string) => ({
  locationId,
  unitCode: "SN-001",
  trackingMode: "SERIALIZED" as const,
  acquisitionCostMinor: 500000,
  acquiredAt: CREATED_AT,
});

describe("inventory unit endpoints", () => {
  describe("GET /listings/:listingId/variants/:variantId/units — inventory:view (all roles)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])("%s can list units", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);

      const res = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const res = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: { "x-merchant-id": fx.merchantId },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /listings/:listingId/variants/:variantId/units — inventory:manage (OWNER/ADMIN only)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can add a unit", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: validUnitPayload(locationId),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };
      expect(body.id).toBeTruthy();

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      const units = listRes.json() as Array<{ acquisitionCostMinor: number; acquiredAt: string }>;
      expect(units).toHaveLength(1);
      expect(units[0]?.acquisitionCostMinor).toBe(500000);
      expect(units[0]?.acquiredAt).toBe(CREATED_AT);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from adding a unit", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: validUnitPayload(locationId),
      });
      expect(res.statusCode).toBe(403);
    });

    it("this card's security check — rejects a unit missing acquisitionCostMinor/acquiredAt with 400", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: { locationId, unitCode: "SN-002", trackingMode: "SERIALIZED" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("ignores a client-supplied variantId and forces it from the URL", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: { ...validUnitPayload(locationId), variantId: "some-other-variant-id" },
      });
      expect(res.statusCode).toBe(201);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      expect((listRes.json() as unknown[]).length).toBe(1);
    });

    it("404s for a variant belonging to another merchant, not 403 or 200", async () => {
      const fx = await setupFixture("OWNER");
      const otherListingId = await createProductListing(fx.connection, fx.otherMerchantId);
      const otherVariantId = await createVariant(fx.connection, fx.otherMerchantId, otherListingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${otherListingId}/variants/${otherVariantId}/units`,
        headers: fx.merchantHeader,
        payload: validUnitPayload(locationId),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /listings/:listingId/variants/:variantId/units/:unitId — inventory:manage (OWNER/ADMIN only)", () => {
    async function createUnit(fx: Fixture, listingId: string, variantId: string, locationId: string): Promise<string> {
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: validUnitPayload(locationId),
      });
      return (res.json() as { id: string }).id;
    }

    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can edit unitCode/conditionGrade", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);
      const unitId = await createUnit(fx, listingId, variantId, locationId);

      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}/units/${unitId}`,
        headers: fx.merchantHeader,
        payload: { unitCode: "SN-001-RELABELED", conditionGrade: "B" },
      });
      expect(res.statusCode).toBe(200);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      const units = listRes.json() as Array<{ id: string; unitCode: string; conditionGrade: string | null }>;
      expect(units.find((u) => u.id === unitId)?.unitCode).toBe("SN-001-RELABELED");
      expect(units.find((u) => u.id === unitId)?.conditionGrade).toBe("B");
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from editing a unit", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);

      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}/units/${generateUuidV7()}`,
        headers: fx.merchantHeader,
        payload: { unitCode: "HIJACKED" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("this card's security check — rejects acquisitionCostMinor in the edit payload with 400", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);
      const unitId = await createUnit(fx, listingId, variantId, locationId);

      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${listingId}/variants/${variantId}/units/${unitId}`,
        headers: fx.merchantHeader,
        payload: { acquisitionCostMinor: 1 },
      });
      expect(res.statusCode).toBe(400);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      const units = listRes.json() as Array<{ id: string; acquisitionCostMinor: number }>;
      expect(units.find((u) => u.id === unitId)?.acquisitionCostMinor).toBe(500000);
    });

    it("404s for a unit belonging to another merchant's variant, not 403 or 200", async () => {
      const fx = await setupFixture("OWNER");
      const otherListingId = await createProductListing(fx.connection, fx.otherMerchantId);
      const otherVariantId = await createVariant(fx.connection, fx.otherMerchantId, otherListingId);
      const otherLocationId = await createLocation(fx.connection, fx.otherMerchantId);
      // Can't authenticate as otherMerchantId's own user via fx's session, so
      // create the cross-tenant unit directly via the repository instead.
      const unitRepo = new InventoryUnitRepository(fx.connection);
      const otherUnitId = unitRepo.create(createTenantContext(fx.otherMerchantId), {
        variantId: otherVariantId,
        locationId: otherLocationId,
        unitCode: "OTHER-1",
        trackingMode: "SERIALIZED",
      });

      const res = await fx.app.inject({
        method: "PUT",
        url: `/listings/${otherListingId}/variants/${otherVariantId}/units/${otherUnitId}`,
        headers: fx.merchantHeader,
        payload: { unitCode: "HIJACKED" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /listings/:listingId/variants/:variantId/units/:unitId/retire — inventory:manage (OWNER/ADMIN only)", () => {
    async function createUnit(fx: Fixture, listingId: string, variantId: string, locationId: string): Promise<string> {
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
        payload: validUnitPayload(locationId),
      });
      return (res.json() as { id: string }).id;
    }

    it("retires an AVAILABLE unit", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);
      const unitId = await createUnit(fx, listingId, variantId, locationId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units/${unitId}/retire`,
        headers: fx.merchantHeader,
        payload: { note: "End of life" },
      });
      expect(res.statusCode).toBe(200);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants/${variantId}/units`,
        headers: fx.merchantHeader,
      });
      const units = listRes.json() as Array<{ id: string; status: string }>;
      expect(units.find((u) => u.id === unitId)?.status).toBe("RETIRED");
    });

    it("409s retiring an already-SOLD unit — terminal state", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);
      const locationId = await createLocation(fx.connection, fx.merchantId);
      const unitId = await createUnit(fx, listingId, variantId, locationId);

      const actorUserId = new UserRepository(fx.connection).create({
        email: "sold@example.com",
        status: "ACTIVE",
        createdAt: CREATED_AT,
      });
      const unitRepo = new InventoryUnitRepository(fx.connection);
      const service = new InventoryUnitService(unitRepo, new AuditLogRepository(fx.connection));
      service.transitionStatus(createTenantContext(fx.merchantId), "OWNER", {
        unitId,
        newStatus: "SOLD",
        actorUserId,
        note: "Sold",
        occurredAt: CREATED_AT,
      });

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units/${unitId}/retire`,
        headers: fx.merchantHeader,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from retiring a unit", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createProductListing(fx.connection, fx.merchantId);
      const variantId = await createVariant(fx.connection, fx.merchantId, listingId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants/${variantId}/units/${generateUuidV7()}/retire`,
        headers: fx.merchantHeader,
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
