import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  InventoryUnitRepository,
  ListingRepository,
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  OrderRepository,
  ReservationRepository,
  UserRepository,
  VariantRepository,
  createConnection,
  runSqliteMigrations,
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
  const userId = dbUsers.create({ email: "staff@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(connection);
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);

  const identity: AuthIdentity = { userId, email: "staff@example.com", roles: [role] };
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
    userId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

interface RentalFixture {
  orderLineId: string;
  inventoryUnitId: string;
}

/** Seeds one RENTAL order line, a serialized inventory unit, and a CONFIRMED reservation linking the two. */
function seedRentalOrderLine(connection: Connection, merchantId: string, customerUserId: string): RentalFixture {
  const ctx = createTenantContext(merchantId);
  const listings = new ListingRepository(connection);
  const variants = new VariantRepository(connection);
  const orders = new OrderRepository(connection);
  const locations = new LocationRepository(connection);
  const units = new InventoryUnitRepository(connection);
  const reservations = new ReservationRepository(connection);

  const listingId = listings.create(ctx, {
    mode: "RENTAL",
    name: "Kayak",
    slug: `kayak-${generateUuidV7()}`,
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variants.create(ctx, {
    listingId,
    mode: "RENTAL",
    sku: `KAYAK-${generateUuidV7()}`,
    name: "Single kayak",
    priceMinor: 5000,
    currency: "USD",
    bufferMinutes: 0,
  });
  const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = units.create(ctx, {
    variantId,
    locationId,
    unitCode: `KAYAK-UNIT-${generateUuidV7()}`,
    trackingMode: "SERIALIZED",
  });
  const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
  const orderLineId = orders.addLine(ctx, orderId, {
    listingId,
    variantId,
    mode: "RENTAL",
    quantity: 1,
    unitPriceMinor: 5000,
    lineTotalMinor: 5000,
    startsAt: "2026-10-02T09:00:00.000Z",
    endsAt: "2026-10-03T09:00:00.000Z",
  });
  reservations.create(ctx, {
    orderLineId,
    subjectType: "INVENTORY_UNIT",
    subjectId: inventoryUnitId,
    startsAt: "2026-10-02T09:00:00.000Z",
    endsAt: "2026-10-03T09:00:00.000Z",
    quantity: 1,
    state: "CONFIRMED",
    createdAt: CREATED_AT,
  });

  return { orderLineId, inventoryUnitId };
}

describe("Rental check-out flow (docs/cards/D116.md)", () => {
  it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF"])(
    "%s can record a CHECKOUT condition report, attach a photo, and pick up",
    async (role) => {
      const fx = await setupFixture(role);
      const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

      const reportRes = await fx.app.inject({
        method: "POST",
        url: `/order-lines/${orderLineId}/condition-reports/checkout`,
        headers: fx.merchantHeader,
        payload: { inventoryUnitId, conditionGrade: "GOOD", notes: "No visible damage." },
      });
      expect(reportRes.statusCode).toBe(201);
      const report = reportRes.json() as { id: string; phase: string };
      expect(report.phase).toBe("CHECKOUT");

      const grantRes = await fx.app.inject({
        method: "POST",
        url: `/condition-reports/${report.id}/media/upload-url`,
        headers: fx.merchantHeader,
        payload: { contentType: "image/jpeg", bytes: 1024 },
      });
      expect(grantRes.statusCode).toBe(201);
      const grant = grantRes.json() as { storageKey: string };

      const bytes = Buffer.from("fake-photo-bytes");
      const confirmRes = await fx.app.inject({
        method: "POST",
        url: `/condition-reports/${report.id}/media/confirm`,
        headers: fx.merchantHeader,
        payload: {
          storageKey: grant.storageKey,
          contentType: "image/jpeg",
          bytesBase64: bytes.toString("base64"),
          declaredSha256: createHash("sha256").update(bytes).digest("hex"),
          capturedAt: CREATED_AT,
        },
      });
      expect(confirmRes.statusCode).toBe(201);

      const pickupRes = await fx.app.inject({
        method: "POST",
        url: `/order-lines/${orderLineId}/pickup`,
        headers: fx.merchantHeader,
        payload: { occurredAt: "2026-10-02T09:00:00.000Z", note: "Customer picked up kayak." },
      });
      expect(pickupRes.statusCode).toBe(201);
    },
  );

  it("this card's acceptance criterion: cannot complete checkout (pickup) without a CHECKOUT condition report on file", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const pickupRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: "2026-10-02T09:00:00.000Z", note: "Attempted pickup with no baseline." },
    });
    expect(pickupRes.statusCode).toBe(409);
  });

  it("READ_ONLY cannot record a CHECKOUT report or record a pickup", async () => {
    const fx = await setupFixture("READ_ONLY");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    expect(reportRes.statusCode).toBe(403);

    const pickupRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: "2026-10-02T09:00:00.000Z", note: "n/a" },
    });
    expect(pickupRes.statusCode).toBe(403);
  });

  it("is tenant-scoped — merchant B cannot record a CHECKOUT report against merchant A's order line", async () => {
    const fxA = await setupFixture("OWNER");
    const fxB = await setupFixture("OWNER");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fxA.connection, fxA.merchantId, fxA.userId);

    const reportRes = await fxB.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fxB.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    expect(reportRes.statusCode).toBe(404);
  });

  it("400s a checkout report with a missing inventoryUnitId or conditionGrade", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const missingUnit = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { conditionGrade: "GOOD" },
    });
    expect(missingUnit.statusCode).toBe(400);

    const missingGrade = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId },
    });
    expect(missingGrade.statusCode).toBe(400);
  });

  it("400s a media upload-url request with a missing contentType or bytes", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const report = reportRes.json() as { id: string };

    const res = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a media confirm request with a missing field", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const report = reportRes.json() as { id: string };

    const res = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/confirm`,
      headers: fx.merchantHeader,
      payload: { storageKey: "x", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an oversized or wrong-type photo upload request", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const report = reportRes.json() as { id: string };

    const wrongType = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "application/pdf", bytes: 1024 },
    });
    expect(wrongType.statusCode).toBe(400);

    const tooLarge = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg", bytes: 50_000_000 },
    });
    expect(tooLarge.statusCode).toBe(400);
  });

  it("404s a pickup for an order line that does not exist", async () => {
    const fx = await setupFixture("STAFF");
    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${generateUuidV7()}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "n/a" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s a pickup with an empty note — the event log is repudiation defence", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("409s a second pickup attempt on an already-picked-up order line", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const first = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: "2026-10-02T09:00:00.000Z", note: "First pickup." },
    });
    expect(first.statusCode).toBe(201);

    const second = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: "2026-10-02T09:05:00.000Z", note: "Second attempt." },
    });
    expect(second.statusCode).toBe(409);
  });

  it("404s a media upload-url or confirm request against a condition report that does not exist", async () => {
    const fx = await setupFixture("STAFF");

    const grantRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${generateUuidV7()}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg", bytes: 1024 },
    });
    expect(grantRes.statusCode).toBe(404);

    const confirmRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${generateUuidV7()}/media/confirm`,
      headers: fx.merchantHeader,
      payload: {
        storageKey: "condition-media/whatever",
        contentType: "image/jpeg",
        bytesBase64: Buffer.from("x").toString("base64"),
        declaredSha256: createHash("sha256").update("x").digest("hex"),
        capturedAt: CREATED_AT,
      },
    });
    expect(confirmRes.statusCode).toBe(404);
  });

  it("READ_ONLY cannot request a media upload URL or confirm a media upload", async () => {
    const fx = await setupFixture("READ_ONLY");
    const grantRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${generateUuidV7()}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg", bytes: 1024 },
    });
    expect(grantRes.statusCode).toBe(403);

    const confirmRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${generateUuidV7()}/media/confirm`,
      headers: fx.merchantHeader,
      payload: {
        storageKey: "condition-media/whatever",
        contentType: "image/jpeg",
        bytesBase64: Buffer.from("x").toString("base64"),
        declaredSha256: createHash("sha256").update("x").digest("hex"),
        capturedAt: CREATED_AT,
      },
    });
    expect(confirmRes.statusCode).toBe(403);
  });

  it("rejects a confirm whose declared hash doesn't match the actual bytes — tamper detection", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const report = reportRes.json() as { id: string };
    const grantRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg", bytes: 1024 },
    });
    const grant = grantRes.json() as { storageKey: string };

    const confirmRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/confirm`,
      headers: fx.merchantHeader,
      payload: {
        storageKey: grant.storageKey,
        contentType: "image/jpeg",
        bytesBase64: Buffer.from("real-bytes").toString("base64"),
        declaredSha256: createHash("sha256").update("not-the-real-bytes").digest("hex"),
        capturedAt: CREATED_AT,
      },
    });
    expect(confirmRes.statusCode).toBe(400);
  });

  it("rejects re-confirming the same storage key twice — evidence cannot be silently swapped", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    const report = reportRes.json() as { id: string };
    const grantRes = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/upload-url`,
      headers: fx.merchantHeader,
      payload: { contentType: "image/jpeg", bytes: 1024 },
    });
    const grant = grantRes.json() as { storageKey: string };
    const bytes = Buffer.from("real-bytes");
    const confirmPayload = {
      storageKey: grant.storageKey,
      contentType: "image/jpeg",
      bytesBase64: bytes.toString("base64"),
      declaredSha256: createHash("sha256").update(bytes).digest("hex"),
      capturedAt: CREATED_AT,
    };

    const first = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/confirm`,
      headers: fx.merchantHeader,
      payload: confirmPayload,
    });
    expect(first.statusCode).toBe(201);

    const second = await fx.app.inject({
      method: "POST",
      url: `/condition-reports/${report.id}/media/confirm`,
      headers: fx.merchantHeader,
      payload: confirmPayload,
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects an unauthenticated request to every route in this file", async () => {
    const fx = await setupFixture("OWNER");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const reportRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    expect(reportRes.statusCode).toBe(401);

    const pickupRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      payload: { occurredAt: CREATED_AT, note: "n/a" },
    });
    expect(pickupRes.statusCode).toBe(401);
  });
});

describe("Rental check-in flow (docs/cards/D117.md)", () => {
  /** Records a CHECKOUT report and pickup so the order line is IN_USE, ready for check-in. */
  async function checkoutAndPickUp(
    fx: Fixture,
    orderLineId: string,
    inventoryUnitId: string,
  ): Promise<void> {
    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD", notes: "No visible damage at pickup." },
    });
    const pickupRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/pickup`,
      headers: fx.merchantHeader,
      payload: { occurredAt: "2026-10-02T09:00:00.000Z", note: "Customer picked up kayak." },
    });
    expect(pickupRes.statusCode).toBe(201);
  }

  it.each<MerchantUserRole>(["OWNER", "ADMIN", "STAFF"])(
    "%s can record a CHECKIN condition report, see the grade delta, and complete the return",
    async (role) => {
      const fx = await setupFixture(role);
      const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
      await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

      const checkinRes = await fx.app.inject({
        method: "POST",
        url: `/order-lines/${orderLineId}/condition-reports/checkin`,
        headers: fx.merchantHeader,
        payload: { inventoryUnitId, conditionGrade: "FAIR", notes: "New scratch on the hull." },
      });
      expect(checkinRes.statusCode).toBe(201);
      const checkin = checkinRes.json() as { delta: { deltaSteps: number; deteriorated: boolean } };
      expect(checkin.delta).toMatchObject({ deltaSteps: -1, deteriorated: true });

      const returnRes = await fx.app.inject({
        method: "POST",
        url: `/order-lines/${orderLineId}/return`,
        headers: fx.merchantHeader,
        payload: { occurredAt: "2026-10-03T09:00:00.000Z", note: "Kayak returned, hull scratched." },
      });
      expect(returnRes.statusCode).toBe(201);
    },
  );

  it("this card's acceptance criterion: rejects a CHECKIN with no CHECKOUT baseline on file", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const checkinRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "FAIR" },
    });
    expect(checkinRes.statusCode).toBe(409);
  });

  it("READ_ONLY cannot record a CHECKIN or a return, but can still read the comparison", async () => {
    const fx = await setupFixture("READ_ONLY");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);

    const checkinRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "FAIR" },
    });
    expect(checkinRes.statusCode).toBe(403);

    const returnRes = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/return`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "n/a" },
    });
    expect(returnRes.statusCode).toBe(403);

    const comparisonRes = await fx.app.inject({
      method: "GET",
      url: `/order-lines/${orderLineId}/condition-reports`,
      headers: fx.merchantHeader,
    });
    expect(comparisonRes.statusCode).toBe(200);
  });

  it("400s a checkin request sent with no body at all", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
    });
    expect(res.statusCode).toBe(400);
  });

  it("records a CHECKIN with no notes supplied — notes defaults to null", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns with no body at all, defaulting the note to empty and occurredAt to now", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);
    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/return`,
      headers: fx.merchantHeader,
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a checkin report with a missing inventoryUnitId or conditionGrade", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

    const missingUnit = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { conditionGrade: "FAIR" },
    });
    expect(missingUnit.statusCode).toBe(400);

    const missingGrade = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId },
    });
    expect(missingGrade.statusCode).toBe(400);
  });

  it("is tenant-scoped — merchant B cannot record a CHECKIN or read the comparison for merchant A's order line", async () => {
    const fxA = await setupFixture("OWNER");
    const fxB = await setupFixture("OWNER");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fxA.connection, fxA.merchantId, fxA.userId);
    await checkoutAndPickUp(fxA, orderLineId, inventoryUnitId);

    // `recordCheckin` (D075) reads merchant B's own tenant-scoped view of this
    // `orderLineId`, which has no CHECKOUT report on it (merchant A's report is
    // invisible to merchant B) — so this fails closed as "no baseline", 409, the
    // same as any other order line with no CHECKOUT on file. No data about
    // merchant A's report ever reaches merchant B's response either way.
    const checkinRes = await fxB.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fxB.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "FAIR" },
    });
    expect(checkinRes.statusCode).toBe(409);

    const comparisonRes = await fxB.app.inject({
      method: "GET",
      url: `/order-lines/${orderLineId}/condition-reports`,
      headers: fxB.merchantHeader,
    });
    expect(comparisonRes.statusCode).toBe(404);
  });

  it("404s a return for an order line that does not exist", async () => {
    const fx = await setupFixture("STAFF");
    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${generateUuidV7()}/return`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "n/a" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s a return with an empty note — the event log is repudiation defence", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/return`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("409s a return attempted before the order line has ever been picked up", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkout`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });

    const res = await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/return`,
      headers: fx.merchantHeader,
      payload: { occurredAt: CREATED_AT, note: "Attempted return with no prior pickup." },
    });
    expect(res.statusCode).toBe(409);
  });

  it("surfaces both reports' confirmed media with server-verified hashes on the comparison read — this card's security check", async () => {
    const fx = await setupFixture("STAFF");
    const { orderLineId, inventoryUnitId } = seedRentalOrderLine(fx.connection, fx.merchantId, fx.userId);
    await checkoutAndPickUp(fx, orderLineId, inventoryUnitId);

    const comparisonBeforeCheckin = await fx.app.inject({
      method: "GET",
      url: `/order-lines/${orderLineId}/condition-reports`,
      headers: fx.merchantHeader,
    });
    expect(comparisonBeforeCheckin.statusCode).toBe(200);
    const beforeCheckin = comparisonBeforeCheckin.json() as {
      checkoutReport: { conditionGrade: string; media: { sha256: string }[] } | null;
      checkinReport: unknown;
      delta: unknown;
    };
    expect(beforeCheckin.checkoutReport?.conditionGrade).toBe("GOOD");
    expect(beforeCheckin.checkinReport).toBeNull();
    expect(beforeCheckin.delta).toBeNull();

    await fx.app.inject({
      method: "POST",
      url: `/order-lines/${orderLineId}/condition-reports/checkin`,
      headers: fx.merchantHeader,
      payload: { inventoryUnitId, conditionGrade: "GOOD" },
    });

    const comparisonAfterCheckin = await fx.app.inject({
      method: "GET",
      url: `/order-lines/${orderLineId}/condition-reports`,
      headers: fx.merchantHeader,
    });
    const afterCheckin = comparisonAfterCheckin.json() as {
      checkinReport: { conditionGrade: string } | null;
      delta: { unchanged: boolean } | null;
    };
    expect(afterCheckin.checkinReport?.conditionGrade).toBe("GOOD");
    expect(afterCheckin.delta).toMatchObject({ unchanged: true });
  });
});
