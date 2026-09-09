import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  BookingService,
  createConnection,
  runSqliteMigrations,
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  ReservationRepository,
  ResourceRepository,
  UserRepository,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";
const STARTS_AT = "2026-10-05T10:00:00.000Z";
const ENDS_AT = "2026-10-05T11:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  otherMerchantId: string;
  resourceId: string;
  otherResourceId: string;
  merchantHeader: Record<string, string>;
  otherMerchantHeader: Record<string, string>;
  app: FastifyInstance;
}

async function createResource(connection: Connection, merchantId: string): Promise<string> {
  const ctx = createTenantContext(merchantId);
  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });
  const resources = new ResourceRepository(connection);
  return resources.create(ctx, { locationId, kind: "STAFF", name: "Jane", capacity: 1 });
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

  const resourceId = await createResource(connection, merchantId);
  const otherResourceId = await createResource(connection, otherMerchantId);

  const dbUsers = new UserRepository(connection);
  const userId = dbUsers.create({ email: "user@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(connection);
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);
  // Not a member of otherMerchantId — used for the cross-tenant/IDOR case.

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
    resourceId,
    otherResourceId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    otherMerchantHeader: { cookie: "session=valid-token", "x-merchant-id": otherMerchantId },
    app,
  };
}

function bookingPayload(resourceId: string): Record<string, unknown> {
  return { resourceId, startsAt: STARTS_AT, endsAt: ENDS_AT, quantity: 1 };
}

function bookingPayloadAt(resourceId: string, hour: number): Record<string, unknown> {
  const startsAt = `2026-10-05T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const endsAt = `2026-10-05T${String(hour + 1).padStart(2, "0")}:00:00.000Z`;
  return { resourceId, startsAt, endsAt, quantity: 1 };
}

function createBookingDirect(connection: Connection, merchantId: string, resourceId: string): string {
  const service = new BookingService(new ResourceRepository(connection), new ReservationRepository(connection));
  return service.createServiceBooking(createTenantContext(merchantId), "OWNER", {
    resourceId,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    quantity: 1,
    idempotencyKey: generateUuidV7(),
    createdAt: CREATED_AT,
  });
}

describe("booking endpoints", () => {
  describe("POST /bookings — bookings:manage (OWNER/ADMIN/STAFF)", () => {
    it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF"])("%s can create a booking", async (role) => {
      const fx = await setupFixture(role);
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { id: string; state: string }).state).toBe("HELD");
    });

    it("READ_ONLY is forbidden from creating a booking", async () => {
      const fx = await setupFixture("READ_ONLY");
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects an unauthenticated request", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { "x-merchant-id": fx.merchantId, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a request missing the Idempotency-Key header with 400", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: fx.merchantHeader,
        payload: bookingPayload(fx.resourceId),
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid payload with 400", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: { resourceId: "" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for a resource belonging to another merchant", async () => {
      const fx = await setupFixture("OWNER");
      const res = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.otherResourceId),
      });
      expect(res.statusCode).toBe(404);
    });

    it("this card's security check — a conflicting booking never reveals the other reservation's identity", async () => {
      const fx = await setupFixture("OWNER");
      const first = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;

      const second = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      expect(second.statusCode).toBe(409);
      expect(second.body).not.toContain(firstId);
      expect(second.body).not.toContain("orderLineId");
      expect(second.body).not.toContain("customer");
    });

    it("a retried request with the same Idempotency-Key replays the original booking", async () => {
      const fx = await setupFixture("OWNER");
      const key = generateUuidV7();
      const first = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": key },
        payload: bookingPayload(fx.resourceId),
      });
      const second = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": key },
        payload: bookingPayload(fx.resourceId),
      });
      expect(second.statusCode).toBe(201);
      expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
    });
  });

  describe("hold exhaustion limits — docs/cards/D062.md, GATE G3", () => {
    it("returns 429 once the acting account is at its concurrent-hold cap, without leaking the cap's value", async () => {
      const fx = await setupFixture("OWNER");

      for (let hour = 0; hour < 5; hour++) {
        const res = await fx.app.inject({
          method: "POST",
          url: "/bookings",
          headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
          payload: bookingPayloadAt(fx.resourceId, hour),
        });
        expect(res.statusCode).toBe(201);
      }

      const overCap = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayloadAt(fx.resourceId, 20),
      });
      expect(overCap.statusCode).toBe(429);
      expect(overCap.body).not.toContain("perAccountLimit");
      expect((overCap.json() as { detail?: string }).detail).not.toMatch(/[0-9]/);
    });
  });

  describe("GET /bookings/:id and POST /bookings/:id/confirm", () => {
    it("OWNER can read and confirm a booking they created", async () => {
      const fx = await setupFixture("OWNER");
      const create = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      const id = (create.json() as { id: string }).id;

      const getRes = await fx.app.inject({ method: "GET", url: `/bookings/${id}`, headers: fx.merchantHeader });
      expect(getRes.statusCode).toBe(200);
      expect((getRes.json() as { state: string }).state).toBe("HELD");

      const confirmRes = await fx.app.inject({
        method: "POST",
        url: `/bookings/${id}/confirm`,
        headers: fx.merchantHeader,
      });
      expect(confirmRes.statusCode).toBe(200);
      expect((confirmRes.json() as { state: string }).state).toBe("CONFIRMED");
    });

    it("READ_ONLY is forbidden from confirming a booking", async () => {
      const fx = await setupFixture("OWNER");
      const create = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      const id = (create.json() as { id: string }).id;

      const readOnlyFx = await setupFixture("READ_ONLY");
      const confirmRes = await readOnlyFx.app.inject({
        method: "POST",
        url: `/bookings/${id}/confirm`,
        headers: fx.merchantHeader,
      });
      expect(confirmRes.statusCode).toBe(403);
    });

    it("confirming an already-confirmed booking returns 409, not a silent no-op", async () => {
      const fx = await setupFixture("OWNER");
      const create = await fx.app.inject({
        method: "POST",
        url: "/bookings",
        headers: { ...fx.merchantHeader, "idempotency-key": generateUuidV7() },
        payload: bookingPayload(fx.resourceId),
      });
      const id = (create.json() as { id: string }).id;
      await fx.app.inject({ method: "POST", url: `/bookings/${id}/confirm`, headers: fx.merchantHeader });

      const secondConfirm = await fx.app.inject({
        method: "POST",
        url: `/bookings/${id}/confirm`,
        headers: fx.merchantHeader,
      });
      expect(secondConfirm.statusCode).toBe(409);
    });
  });

  describe("cross-tenant isolation (IDOR) — this card's acceptance criterion", () => {
    it("a booking created by another merchant is not readable — returns 404, not 200 or 403", async () => {
      const fx = await setupFixture("OWNER");
      const otherBookingId = createBookingDirect(fx.connection, fx.otherMerchantId, fx.otherResourceId);

      const res = await fx.app.inject({
        method: "GET",
        url: `/bookings/${otherBookingId}`,
        headers: fx.merchantHeader,
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("orderLineId");
    });

    it("cannot confirm another merchant's booking — returns 404", async () => {
      const fx = await setupFixture("OWNER");
      const otherBookingId = createBookingDirect(fx.connection, fx.otherMerchantId, fx.otherResourceId);

      const res = await fx.app.inject({
        method: "POST",
        url: `/bookings/${otherBookingId}/confirm`,
        headers: fx.merchantHeader,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("hold countdown (D127) — an unswept expired hold cannot be silently confirmed", () => {
    it("confirming a booking after its hold has expired returns 409 with a clear, recoverable message", async () => {
      const fx = await setupFixture("OWNER");
      const service = new BookingService(new ResourceRepository(fx.connection), new ReservationRepository(fx.connection));
      const id = service.createServiceBooking(createTenantContext(fx.merchantId), "OWNER", {
        resourceId: fx.resourceId,
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        quantity: 1,
        idempotencyKey: generateUuidV7(),
        createdAt: CREATED_AT,
        // Already expired relative to real "now" — the route always confirms
        // against the current instant, never a caller-supplied one.
        expiresAt: CREATED_AT,
      });

      const confirmRes = await fx.app.inject({
        method: "POST",
        url: `/bookings/${id}/confirm`,
        headers: fx.merchantHeader,
      });

      expect(confirmRes.statusCode).toBe(409);
      expect((confirmRes.json() as { detail?: string }).detail).toMatch(/expired/i);

      const getRes = await fx.app.inject({ method: "GET", url: `/bookings/${id}`, headers: fx.merchantHeader });
      expect((getRes.json() as { state: string }).state).toBe("HELD");
    });
  });
});
