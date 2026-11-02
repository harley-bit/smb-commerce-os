import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  InventoryUnitRepository,
  ListingRepository,
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  ReservationRepository,
  ResourceRepository,
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
  locationId: string;
  resourceId: string;
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

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });

  const resources = new ResourceRepository(connection);
  const resourceId = resources.create(ctx, { locationId, kind: "STAFF", name: "Jane", capacity: 1 });

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
    createAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    exchangeAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    refreshMobileSession: () => Promise.reject(new Error("not implemented")),
    revokeMobileSession: () => Promise.resolve(),
  };

  const app = buildApp({
    authProvider: fakeAuthProvider,
    merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    connection,
  });

  return {
    connection,
    merchantId,
    locationId,
    resourceId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

async function createRentalUnit(connection: Connection, merchantId: string, locationId: string): Promise<string> {
  const ctx = createTenantContext(merchantId);
  const listings = new ListingRepository(connection);
  const listingId = listings.create(ctx, {
    mode: "RENTAL",
    name: "Kayak",
    slug: `kayak-${generateUuidV7()}`,
    status: "DRAFT",
    createdAt: CREATED_AT,
  });
  const variants = new VariantRepository(connection);
  const variantId = variants.create(ctx, {
    listingId,
    mode: "RENTAL",
    sku: `KAYAK-${generateUuidV7()}`,
    name: "Single kayak",
    priceMinor: 5000,
    currency: "USD",
    bufferMinutes: 0,
  });
  const units = new InventoryUnitRepository(connection);
  return units.create(ctx, {
    variantId,
    locationId,
    unitCode: "KAYAK-001",
    trackingMode: "SERIALIZED",
  });
}

describe("GET /calendar — unified calendar", () => {
  it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])(
    "%s sees both a RESOURCE booking and an INVENTORY_UNIT rental on one calendar",
    async (role) => {
      const fx = await setupFixture(role);
      const ctx = createTenantContext(fx.merchantId);
      const reservations = new ReservationRepository(fx.connection);
      reservations.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: fx.resourceId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: CREATED_AT,
      });

      const rentalUnitId = await createRentalUnit(fx.connection, fx.merchantId, fx.locationId);
      reservations.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: rentalUnitId,
        startsAt: "2026-10-01T11:00:00.000Z",
        endsAt: "2026-10-01T12:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: CREATED_AT,
      });

      const res = await fx.app.inject({
        method: "GET",
        url: "/calendar?rangeStart=2026-10-01T00:00:00.000Z&rangeEnd=2026-10-02T00:00:00.000Z",
        headers: fx.merchantHeader,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ subjectType: string; subjectLabel: string; hasConflict: boolean }>;
      expect(body).toHaveLength(2);
      const bySubject = new Map(body.map((e) => [e.subjectType, e]));
      expect(bySubject.get("RESOURCE")).toMatchObject({ subjectLabel: "Jane", hasConflict: false });
      expect(bySubject.get("INVENTORY_UNIT")).toMatchObject({ subjectLabel: "KAYAK-001", hasConflict: false });
    },
  );

  it("never includes createdByIp on any entry (this card's security check)", async () => {
    const fx = await setupFixture("OWNER");
    const ctx = createTenantContext(fx.merchantId);
    const reservations = new ReservationRepository(fx.connection);
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: fx.resourceId,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
      createdByIp: "203.0.113.5",
    });

    const res = await fx.app.inject({
      method: "GET",
      url: "/calendar?rangeStart=2026-10-01T00:00:00.000Z&rangeEnd=2026-10-02T00:00:00.000Z",
      headers: fx.merchantHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty("createdByIp");
    expect(body[0]).not.toHaveProperty("createdByAccountId");
  });

  it("400s when rangeStart/rangeEnd are missing", async () => {
    const fx = await setupFixture("OWNER");
    const res = await fx.app.inject({ method: "GET", url: "/calendar", headers: fx.merchantHeader });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const fx = await setupFixture("OWNER");
    const res = await fx.app.inject({
      method: "GET",
      url: "/calendar?rangeStart=2026-10-01T00:00:00.000Z&rangeEnd=2026-10-02T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(401);
  });

  it("is tenant-scoped — merchant B never sees merchant A's calendar entries", async () => {
    const fxA = await setupFixture("OWNER");
    const fxB = await setupFixture("OWNER");
    const ctxA = createTenantContext(fxA.merchantId);
    const reservations = new ReservationRepository(fxA.connection);
    reservations.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: fxA.resourceId,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const res = await fxB.app.inject({
      method: "GET",
      url: "/calendar?rangeStart=2026-10-01T00:00:00.000Z&rangeEnd=2026-10-02T00:00:00.000Z",
      headers: fxB.merchantHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
