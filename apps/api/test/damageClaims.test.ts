import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  DepositAuthorizationRepository,
  DepositAuthorizationService,
  ListingRepository,
  MerchantRepository,
  MerchantUserRepository,
  OrderRepository,
  PaymentRepository,
  SimulatedDepositHoldProvider,
  UserRepository,
  VariantRepository,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";
/** The order line's `depositMinor` — the "authorized amount" this card's acceptance criterion bounds a capture against. */
const DEPOSIT_MINOR = 20_000;

interface Base {
  connection: Connection;
  merchantId: string;
  orderLineId: string;
  /** Shared across every `buildRoleApp`/`placeDepositHold` call for this base — the provider is stateful in-memory, so a hold placed against one instance is invisible to another. */
  depositHoldProvider: SimulatedDepositHoldProvider;
}

interface RoleApp {
  app: FastifyInstance;
  headers: Record<string, string>;
}

async function setupBase(): Promise<Base> {
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

  const customerUsers = new UserRepository(connection);
  const customerUserId = customerUsers.create({ email: "customer@example.com", status: "ACTIVE", createdAt: CREATED_AT });

  const listingRepo = new ListingRepository(connection);
  const variantRepo = new VariantRepository(connection);
  const orderRepo = new OrderRepository(connection);
  const listingId = listingRepo.create(ctx, {
    mode: "RENTAL",
    name: "Trailer",
    slug: `trailer-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variantRepo.create(ctx, {
    listingId,
    mode: "RENTAL",
    sku: "TRAILER-1",
    name: "Trailer — default",
    priceMinor: 5_000,
    currency: "USD",
    ratePeriod: "DAY",
    depositMinor: DEPOSIT_MINOR,
  });
  const orderId = orderRepo.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
  const orderLineId = orderRepo.addLine(ctx, orderId, {
    listingId,
    variantId,
    mode: "RENTAL",
    quantity: 1,
    unitPriceMinor: 5_000,
    lineTotalMinor: 10_000,
    depositMinor: DEPOSIT_MINOR,
  });

  return {
    connection,
    merchantId,
    orderLineId,
    // Real clock, not the fixed CREATED_AT: the provider's 7-day window is measured from
    // its clock, and the route classifies against wall-clock `now` — a fixed date silently
    // turned every HELD assertion into EXPIRING_SOON once the calendar passed CREATED_AT + 7d.
    depositHoldProvider: new SimulatedDepositHoldProvider(() => new Date(), 7),
  };
}

/** A distinct staff user with the given role, sharing the same merchant/connection — its own `buildApp()` instance, same shape `rentals.test.ts` uses. */
function buildRoleApp(base: Base, role: MerchantUserRole): RoleApp {
  const dbUsers = new UserRepository(base.connection);
  const ctx = createTenantContext(base.merchantId);
  const userId = dbUsers.create({ email: `${role.toLowerCase()}-${generateUuidV7()}@example.com`, status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(base.connection);
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);

  const identity: AuthIdentity = { userId, email: `${role}@example.com`, roles: [role] };
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
    merchantMembershipResolver: new DbMerchantMembershipResolver(base.connection),
    connection: base.connection,
    depositHoldProvider: base.depositHoldProvider,
  });

  return { app, headers: { cookie: "session=valid-token", "x-merchant-id": base.merchantId } };
}

async function placeDepositHold(base: Base): Promise<void> {
  const ctx = createTenantContext(base.merchantId);
  const depositService = new DepositAuthorizationService(
    new OrderRepository(base.connection),
    new PaymentRepository(base.connection),
    new DepositAuthorizationRepository(base.connection),
    base.depositHoldProvider,
  );
  await depositService.placeHold(ctx, {
    orderLineId: base.orderLineId,
    connectedAccountId: "acct_123",
    idempotencyKey: `hold-${base.orderLineId}`,
    authorizedAt: CREATED_AT,
  });
}

async function fileAndNotify(base: Base, staff: RoleApp, amountMinor = 7_500): Promise<string> {
  const fileRes = await staff.app.inject({
    method: "POST",
    url: `/order-lines/${base.orderLineId}/damage-claims`,
    headers: staff.headers,
    payload: { amountMinor, filedAt: CREATED_AT },
  });
  const { id } = fileRes.json() as { id: string };
  await staff.app.inject({ method: "POST", url: `/damage-claims/${id}/notify`, headers: staff.headers, payload: {} });
  return id;
}

describe("damage claim routes — D118", () => {
  describe("POST /order-lines/:orderLineId/damage-claims — file", () => {
    it("files a claim as STAFF and returns 201", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: expect.any(String) });
    });

    it("400s on a missing amountMinor", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("403s for READ_ONLY", async () => {
      const base = await setupBase();
      const readOnly = buildRoleApp(base, "READ_ONLY");

      const res = await readOnly.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: readOnly.headers,
        payload: { amountMinor: 7_500 },
      });

      expect(res.statusCode).toBe(403);
    });

    it("400s on a zero amountMinor", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 0 },
      });

      expect(res.statusCode).toBe(400);
    });

    it("defaults filedAt to now when omitted", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500 },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  describe("GET /order-lines/:orderLineId/damage-claims — review", () => {
    it("lists claims filed against the order line, readable by READ_ONLY", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const readOnly = buildRoleApp(base, "READ_ONLY");
      await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });

      const res = await readOnly.app.inject({
        method: "GET",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: readOnly.headers,
      });

      expect(res.statusCode).toBe(200);
      const claims = res.json() as { amountMinor: number; state: string }[];
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ amountMinor: 7_500, state: "FILED" });
    });
  });

  describe("GET /order-lines/:orderLineId/deposit-authorization — the capture bound", () => {
    it("returns the deposit hold's own authorized amount", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);

      const res = await owner.app.inject({
        method: "GET",
        url: `/order-lines/${base.orderLineId}/deposit-authorization`,
        headers: owner.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ amountMinor: DEPOSIT_MINOR, state: "AUTHORIZED" });
    });

    it("returns null when no deposit hold is on file", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");

      const res = await owner.app.inject({
        method: "GET",
        url: `/order-lines/${base.orderLineId}/deposit-authorization`,
        headers: owner.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
    });

    it("is readable by READ_ONLY", async () => {
      const base = await setupBase();
      const readOnly = buildRoleApp(base, "READ_ONLY");
      await placeDepositHold(base);

      const res = await readOnly.app.inject({
        method: "GET",
        url: `/order-lines/${base.orderLineId}/deposit-authorization`,
        headers: readOnly.headers,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /deposits — D119 deposit management view", () => {
    it("returns 200 with an empty list when no deposits exist", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");

      const res = await owner.app.inject({ method: "GET", url: "/deposits", headers: owner.headers });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("buckets a freshly authorized hold as HELD", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);

      const res = await owner.app.inject({ method: "GET", url: "/deposits", headers: owner.headers });

      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<{ orderLineId: string; state: string; bucket: string; amountMinor: number }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ orderLineId: base.orderLineId, state: "AUTHORIZED", bucket: "HELD", amountMinor: DEPOSIT_MINOR });
    });

    it("buckets a captured hold as CAPTURED", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner);
      await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: DEPOSIT_MINOR, idempotencyKey: "cap-1", capturedAt: CREATED_AT },
      });

      const res = await owner.app.inject({ method: "GET", url: "/deposits", headers: owner.headers });

      const rows = res.json() as Array<{ state: string; bucket: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "CAPTURED", bucket: "CAPTURED" });
    });

    it("buckets a released hold as RELEASED", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const deposits = new DepositAuthorizationRepository(base.connection);
      const depositService = new DepositAuthorizationService(
        new OrderRepository(base.connection),
        new PaymentRepository(base.connection),
        deposits,
        base.depositHoldProvider,
      );
      const ctx = createTenantContext(base.merchantId);
      const deposit = deposits.findByOrderLineId(ctx, base.orderLineId)!;
      await depositService.releaseHold(ctx, { depositAuthorizationId: deposit.id, releasedAt: CREATED_AT });

      const res = await owner.app.inject({ method: "GET", url: "/deposits", headers: owner.headers });

      const rows = res.json() as Array<{ state: string; bucket: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "RELEASED", bucket: "RELEASED" });
    });

    it("buckets a still-AUTHORIZED hold within 72h of expiry as EXPIRING_SOON, not HELD", async () => {
      const base = await setupBase();
      // A 1-day provider authorization window puts expiresAt well inside the 72h expiring-soon window from CREATED_AT.
      const shortWindowProvider = new SimulatedDepositHoldProvider(() => new Date(CREATED_AT), 1);
      const shortBase = { ...base, depositHoldProvider: shortWindowProvider };
      await placeDepositHold(shortBase);
      const shortOwner = buildRoleApp(shortBase, "OWNER");

      const res = await shortOwner.app.inject({ method: "GET", url: "/deposits", headers: shortOwner.headers });

      const rows = res.json() as Array<{ state: string; bucket: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "AUTHORIZED", bucket: "EXPIRING_SOON" });
    });

    it("is readable by READ_ONLY", async () => {
      const base = await setupBase();
      const readOnly = buildRoleApp(base, "READ_ONLY");
      await placeDepositHold(base);

      const res = await readOnly.app.inject({ method: "GET", url: "/deposits", headers: readOnly.headers });

      expect(res.statusCode).toBe(200);
    });

    it("does not leak another merchant's deposits", async () => {
      const base = await setupBase();
      const other = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(other);

      const res = await owner.app.inject({ method: "GET", url: "/deposits", headers: owner.headers });

      expect(res.json()).toEqual([]);
    });
  });

  describe("POST /damage-claims/:claimId/notify", () => {
    it("moves a claim to CUSTOMER_NOTIFIED", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const fileRes = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });
      const { id } = fileRes.json() as { id: string };

      const res = await staff.app.inject({ method: "POST", url: `/damage-claims/${id}/notify`, headers: staff.headers, payload: {} });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: "CUSTOMER_NOTIFIED" });
    });

    it("404s for an unknown claim id", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${generateUuidV7()}/notify`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("409s notifying a claim that's already been notified", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const claimId = await fileAndNotify(base, staff, 7_500);

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/notify`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(409);
    });

    it("403s for READ_ONLY", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const readOnly = buildRoleApp(base, "READ_ONLY");
      const fileRes = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });
      const { id } = fileRes.json() as { id: string };

      const res = await readOnly.app.inject({
        method: "POST",
        url: `/damage-claims/${id}/notify`,
        headers: readOnly.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /damage-claims/:claimId/capture — this card's acceptance criterion", () => {
    it("captures an amount within the authorized deposit and resolves the claim", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-1", capturedAt: CREATED_AT },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        claimId,
        state: "PARTIALLY_CAPTURED",
        capturedMinor: 7_500,
        releasedRemainderMinor: DEPOSIT_MINOR - 7_500,
      });

      const listRes = await owner.app.inject({
        method: "GET",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: owner.headers,
      });
      expect((listRes.json() as { state: string }[])[0]).toMatchObject({ state: "RESOLVED_CAPTURED" });
    });

    it("400s a capture amount above the authorized deposit amount — this card's acceptance criterion", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: DEPOSIT_MINOR + 1, idempotencyKey: "cap-2", capturedAt: CREATED_AT },
      });

      expect(res.statusCode).toBe(400);
    });

    it("409s a second capture attempt on the same deposit hold — this card's security check, one attempt only", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const first = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-3", capturedAt: CREATED_AT },
      });
      expect(first.statusCode).toBe(200);

      const second = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 5_000, idempotencyKey: "cap-4", capturedAt: CREATED_AT },
      });

      expect(second.statusCode).toBe(409);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])("%s is forbidden from capturing", async (role) => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const actor = role === "STAFF" ? staff : buildRoleApp(base, role);
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, staff, 7_500);

      const res = await actor.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: actor.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-5", capturedAt: CREATED_AT },
      });

      expect(res.statusCode).toBe(403);
    });

    it("409s when the order line has no deposit hold on file", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-6", capturedAt: CREATED_AT },
      });

      expect(res.statusCode).toBe(409);
    });

    it("400s a missing idempotencyKey", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500 },
      });

      expect(res.statusCode).toBe(400);
    });

    it("400s an empty-string idempotencyKey", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("400s a zero amountMinor", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 0, idempotencyKey: "cap-9" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("defaults capturedAt to now and accepts a resolutionNote when omitted/provided", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const claimId = await fileAndNotify(base, owner, 7_500);

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-10", resolutionNote: "Scratch on the panel." },
      });

      expect(res.statusCode).toBe(200);
    });

    it("404s for an unknown claim id", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${generateUuidV7()}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-7" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("409s capturing a claim still in FILED — the customer must be notified first", async () => {
      const base = await setupBase();
      const owner = buildRoleApp(base, "OWNER");
      await placeDepositHold(base);
      const fileRes = await owner.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });
      const { id: claimId } = fileRes.json() as { id: string };

      const res = await owner.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/capture`,
        headers: owner.headers,
        payload: { amountMinor: 7_500, idempotencyKey: "cap-8" },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe("POST /damage-claims/:claimId/waive", () => {
    it("waives a claim, reaching RESOLVED_WAIVED", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const claimId = await fileAndNotify(base, staff, 7_500);

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/waive`,
        headers: staff.headers,
        payload: { resolvedAt: CREATED_AT, resolutionNote: "No damage found." },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: "RESOLVED_WAIVED" });
    });

    it("403s for READ_ONLY", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const readOnly = buildRoleApp(base, "READ_ONLY");
      const claimId = await fileAndNotify(base, staff, 7_500);

      const res = await readOnly.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/waive`,
        headers: readOnly.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });

    it("404s for an unknown claim id", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${generateUuidV7()}/waive`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("409s waiving a claim still in FILED — the customer must be notified first", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const fileRes = await staff.app.inject({
        method: "POST",
        url: `/order-lines/${base.orderLineId}/damage-claims`,
        headers: staff.headers,
        payload: { amountMinor: 7_500, filedAt: CREATED_AT },
      });
      const { id: claimId } = fileRes.json() as { id: string };

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/waive`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(409);
    });

    it("409s waiving an already-resolved claim", async () => {
      const base = await setupBase();
      const staff = buildRoleApp(base, "STAFF");
      const claimId = await fileAndNotify(base, staff, 7_500);
      await staff.app.inject({ method: "POST", url: `/damage-claims/${claimId}/waive`, headers: staff.headers, payload: {} });

      const res = await staff.app.inject({
        method: "POST",
        url: `/damage-claims/${claimId}/waive`,
        headers: staff.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(409);
    });
  });
});
