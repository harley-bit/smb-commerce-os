import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  AvailabilityExceptionRepository,
  AvailabilityRuleRepository,
  ListingRepository,
  ListingResourceRepository,
  ListingService,
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  ResourceRepository,
  ResourceService,
  UserRepository,
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
  locationId: string;
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

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });

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
    locationId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

async function createServiceListing(app: FastifyInstance, headers: Record<string, string>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/listings",
    headers,
    payload: {
      mode: "SERVICE",
      name: "Haircut",
      slug: `haircut-${generateUuidV7()}`,
      status: "DRAFT",
      createdAt: CREATED_AT,
    },
  });
  return (res.json() as { id: string }).id;
}

/**
 * Same precedent as `variants.test.ts`'s `createProductListing` — creates
 * a listing/resource directly through the (already-authorization-tested)
 * service layer as OWNER, bypassing HTTP-level RBAC, so a forbidden-role
 * test can prove *that route's* rejection without the fixture also having
 * to be an OWNER just to seed data.
 */
async function createServiceListingDirect(connection: Connection, merchantId: string): Promise<string> {
  const service = new ListingService(new ListingRepository(connection));
  return service.create(createTenantContext(merchantId), "OWNER", {
    mode: "SERVICE",
    name: "Haircut",
    slug: `haircut-${generateUuidV7()}`,
    status: "DRAFT",
    createdAt: CREATED_AT,
  });
}

async function createResourceDirect(connection: Connection, merchantId: string, locationId: string): Promise<string> {
  const service = new ResourceService(
    new ResourceRepository(connection),
    new AvailabilityRuleRepository(connection),
    new AvailabilityExceptionRepository(connection),
    new ListingResourceRepository(connection),
    new ListingRepository(connection),
  );
  return service.createResource(createTenantContext(merchantId), "OWNER", {
    locationId,
    kind: "STAFF",
    name: "Jamie Rivera",
    capacity: 1,
  });
}

describe("resource endpoints", () => {
  describe("GET/POST /resources — catalog:view (all)/catalog:manage (OWNER/ADMIN)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF", "READ_ONLY"])("%s can list resources", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({ method: "GET", url: "/resources", headers: fx.merchantHeader });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it.each<MerchantUserRole>(["OWNER", "ADMIN"])("%s can create a resource", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { id: string }).id).toBeTruthy();
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from creating a resource", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({ method: "GET", url: "/resources" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET/POST /listings/:listingId/resources — assignment respects tenant scope (this card's security check)", () => {
    it("OWNER assigns a resource to a SERVICE listing and it appears in the listing's assignment list", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createServiceListing(fx.app, fx.merchantHeader);
      const resourceRes = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      const resourceId = (resourceRes.json() as { id: string }).id;

      const assignRes = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId },
      });
      expect(assignRes.statusCode).toBe(201);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/resources`,
        headers: fx.merchantHeader,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json()).toEqual([expect.objectContaining({ listingId, resourceId })]);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from assigning a resource", async (role) => {
      const fx = await setupFixture(role);
      const listingId = await createServiceListingDirect(fx.connection, fx.merchantId);
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects assigning a resource to a listing owned by another merchant with 404", async () => {
      const fx = await setupFixture("OWNER");
      const otherListingId = await createServiceListingDirect(fx.connection, fx.otherMerchantId);
      const resourceRes = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      const resourceId = (resourceRes.json() as { id: string }).id;

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${otherListingId}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s for a nonexistent listing", async () => {
      const fx = await setupFixture("OWNER");
      const resourceRes = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      const resourceId = (resourceRes.json() as { id: string }).id;

      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${generateUuidV7()}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s assigning a resource id that belongs to another merchant — cross-tenant assignment rejected", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createServiceListing(fx.app, fx.merchantHeader);

      const otherLocations = new LocationRepository(fx.connection);
      const otherLocationId = otherLocations.create(createTenantContext(fx.otherMerchantId), {
        name: "Other Shop",
        timezone: "UTC",
      });
      const otherResourceId = await createResourceDirect(fx.connection, fx.otherMerchantId, otherLocationId);

      // Same connection as `fx`, so this is a real cross-tenant IDOR attempt, not
      // merely a not-found id — `otherResourceId` genuinely exists, just under a
      // different merchant than the caller's session.
      const res = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId: otherResourceId },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("service bookable after save — this card's acceptance criterion", () => {
    it("a SERVICE listing saved with a duration variant and an assigned resource can be booked", async () => {
      const fx = await setupFixture("OWNER");

      const listingId = await createServiceListing(fx.app, fx.merchantHeader);

      const variantRes = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: { sku: "HAIRCUT-STD", name: "Standard haircut", priceMinor: 4500, currency: "USD", durationMinutes: 30 },
      });
      expect(variantRes.statusCode).toBe(201);

      const resourceRes = await fx.app.inject({
        method: "POST",
        url: "/resources",
        headers: fx.merchantHeader,
        payload: { locationId: fx.locationId, kind: "STAFF", name: "Jamie Rivera", capacity: 1 },
      });
      const resourceId = (resourceRes.json() as { id: string }).id;

      const assignRes = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/resources`,
        headers: fx.merchantHeader,
        payload: { resourceId },
      });
      expect(assignRes.statusCode).toBe(201);

      // Proof of "bookable": the resource this listing was just saved with actually
      // occupies a real HELD reservation via the pre-existing booking endpoint (D061).
      const bookingRes = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: {
          resourceId,
          startsAt: "2026-10-05T10:00:00.000Z",
          endsAt: "2026-10-05T10:30:00.000Z",
          quantity: 1,
        },
      });
      expect(bookingRes.statusCode).toBe(201);
      expect(bookingRes.json()).toMatchObject({ state: "HELD" });
    });
  });

  describe("GET /locations — timezone lookup for the resources/availability editor (D112)", () => {
    it("OWNER lists this merchant's locations, including timezone", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({ method: "GET", url: "/locations", headers: fx.merchantHeader });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([expect.objectContaining({ id: fx.locationId, timezone: "UTC" })]);
    });

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({ method: "GET", url: "/locations" });
      expect(res.statusCode).toBe(401);
    });

    it("never returns another merchant's locations", async () => {
      const fx = await setupFixture("OWNER");
      const otherLocations = new LocationRepository(fx.connection);
      otherLocations.create(createTenantContext(fx.otherMerchantId), { name: "Other Shop", timezone: "America/New_York" });

      const res = await fx.app.inject({ method: "GET", url: "/locations", headers: fx.merchantHeader });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([expect.objectContaining({ id: fx.locationId })]);
    });
  });

  describe("GET/POST /resources/:resourceId/availability-rules — weekly rules per resource (D112 deliverable)", () => {
    it("OWNER creates a weekly rule and it appears in the resource's rule list", async () => {
      const fx = await setupFixture("OWNER");
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);

      const createRes = await fx.app.inject({
        method: "POST",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
        payload: { weekday: 1, startTime: "09:00", endTime: "17:00" },
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json()).toEqual([
        expect.objectContaining({ resourceId, weekday: 1, startTime: "09:00", endTime: "17:00" }),
      ]);
    });

    it("forces resourceId from the URL, ignoring any resourceId smuggled in the body", async () => {
      const fx = await setupFixture("OWNER");
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);
      const otherResourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);

      const createRes = await fx.app.inject({
        method: "POST",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
        payload: { resourceId: otherResourceId, weekday: 2, startTime: "10:00", endTime: "12:00" },
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await fx.app.inject({
        method: "GET",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
      });
      expect(listRes.json()).toEqual([expect.objectContaining({ resourceId })]);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from creating a weekly rule", async (role) => {
      const fx = await setupFixture(role);
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);
      const res = await fx.app.inject({
        method: "POST",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
        payload: { weekday: 1, startTime: "09:00", endTime: "17:00" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("404s creating a rule against another merchant's resource", async () => {
      const fx = await setupFixture("OWNER");
      const otherLocations = new LocationRepository(fx.connection);
      const otherLocationId = otherLocations.create(createTenantContext(fx.otherMerchantId), {
        name: "Other Shop",
        timezone: "UTC",
      });
      const otherResourceId = await createResourceDirect(fx.connection, fx.otherMerchantId, otherLocationId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/resources/${otherResourceId}/availability-rules`,
        headers: fx.merchantHeader,
        payload: { weekday: 1, startTime: "09:00", endTime: "17:00" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /resources/:resourceId/availability — DST-correct read in the resource's location timezone (D112 acceptance + security check)", () => {
    it("expands a weekly rule across a DST spring-forward boundary into the correct UTC instants", async () => {
      const fx = await setupFixture("OWNER");
      const nyLocations = new LocationRepository(fx.connection);
      const nyLocationId = nyLocations.create(createTenantContext(fx.merchantId), {
        name: "NY Shop",
        timezone: "America/New_York",
      });
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, nyLocationId);

      // Sunday, both sides of the US 2027 spring-forward (2027-03-14).
      await fx.app.inject({
        method: "POST",
        url: `/resources/${resourceId}/availability-rules`,
        headers: fx.merchantHeader,
        payload: { weekday: 0, startTime: "09:00", endTime: "17:00" },
      });

      const res = await fx.app.inject({
        method: "GET",
        url: `/resources/${resourceId}/availability?from=2027-03-07T00:00:00.000Z&to=2027-03-21T00:00:00.000Z`,
        headers: fx.merchantHeader,
      });
      expect(res.statusCode).toBe(200);
      const free = (res.json() as { free: { start: string; end: string }[] }).free;

      // Before the transition: EST is UTC-5, so 09:00 local is 14:00 UTC.
      expect(free).toContainEqual({ start: "2027-03-07T14:00:00.000Z", end: "2027-03-07T22:00:00.000Z" });
      // After the transition: EDT is UTC-4, so 09:00 local is 13:00 UTC — proving
      // the route reads the *resource's own location* timezone, not a fixed offset.
      expect(free).toContainEqual({ start: "2027-03-14T13:00:00.000Z", end: "2027-03-14T21:00:00.000Z" });
    });

    it("404s for a nonexistent resource", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "GET",
        url: `/resources/${generateUuidV7()}/availability?from=2027-03-07T00:00:00.000Z&to=2027-03-21T00:00:00.000Z`,
        headers: fx.merchantHeader,
      });
      expect(res.statusCode).toBe(404);
    });

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const resourceId = await createResourceDirect(fx.connection, fx.merchantId, fx.locationId);
      const res = await fx.app.inject({
        method: "GET",
        url: `/resources/${resourceId}/availability?from=2027-03-07T00:00:00.000Z&to=2027-03-21T00:00:00.000Z`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
