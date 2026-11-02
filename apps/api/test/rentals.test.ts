import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  DepositAuthorizationRepository,
  DepositAuthorizationService,
  InventoryUnitRepository,
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  OrderRepository,
  PaymentRepository,
  RentalReservationService,
  ReservationRepository,
  SimulatedDepositHoldProvider,
  UserRepository,
  VariantRepository,
  type Connection,
  type MerchantUserRole,
  type Variant,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  locationId: string;
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
    userId,
    merchantHeader: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

async function createRentalListing(app: FastifyInstance, headers: Record<string, string>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/listings",
    headers,
    payload: {
      mode: "RENTAL",
      name: "Kayak",
      slug: `kayak-${generateUuidV7()}`,
      status: "DRAFT",
      createdAt: CREATED_AT,
    },
  });
  return (res.json() as { id: string }).id;
}

describe("rental listing/variant editor — this card's deliverable (D108)", () => {
  describe("POST /listings/:listingId/variants — RENTAL rate period, deposit, buffer", () => {
    it("persists ratePeriod, depositMinor, and bufferMinutes exactly as configured, read back unchanged", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createRentalListing(fx.app, fx.merchantHeader);

      const createRes = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: {
          sku: "KAYAK-1",
          name: "Single kayak",
          priceMinor: 5000,
          currency: "USD",
          ratePeriod: "DAY",
          depositMinor: 20000,
          bufferMinutes: 30,
        },
      });
      expect(createRes.statusCode).toBe(201);

      const readBackRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
      });
      expect(readBackRes.statusCode).toBe(200);
      const variants = readBackRes.json() as Variant[];
      expect(variants).toEqual([
        expect.objectContaining({ ratePeriod: "DAY", depositMinor: 20000, bufferMinutes: 30 }),
      ]);
    });

    it.each<MerchantUserRole>(["STAFF", "READ_ONLY"])(
      "%s is forbidden from saving a RENTAL variant's deposit/buffer configuration",
      async (role) => {
        const fx = await setupFixture(role);
        const listingId = await createRentalListing(fx.app, fx.merchantHeader);

        const res = await fx.app.inject({
          method: "POST",
          url: `/listings/${listingId}/variants`,
          headers: fx.merchantHeader,
          payload: {
            sku: "KAYAK-1",
            name: "Single kayak",
            priceMinor: 5000,
            currency: "USD",
            ratePeriod: "DAY",
            depositMinor: 20000,
            bufferMinutes: 30,
          },
        });
        expect(res.statusCode).toBe(403);
      },
    );
  });

  describe("deposit and buffer apply — this card's acceptance criterion", () => {
    it("a RENTAL variant saved through the editor's own routes drives a real buffer-expanded reservation and a real deposit hold for the exact configured amount", async () => {
      const fx = await setupFixture("OWNER");
      const listingId = await createRentalListing(fx.app, fx.merchantHeader);

      const variantRes = await fx.app.inject({
        method: "POST",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
        payload: {
          sku: "KAYAK-1",
          name: "Single kayak",
          priceMinor: 5000,
          currency: "USD",
          ratePeriod: "DAY",
          depositMinor: 20000,
          bufferMinutes: 30,
        },
      });
      const { id: variantId } = variantRes.json() as { id: string };

      const readBackRes = await fx.app.inject({
        method: "GET",
        url: `/listings/${listingId}/variants`,
        headers: fx.merchantHeader,
      });
      const variant = (readBackRes.json() as Variant[])[0]!;

      const ctx = createTenantContext(fx.merchantId);

      // Buffer applies: a real reservation against the just-saved variant is
      // expanded by its own persisted `bufferMinutes` (`expandIntervalForBuffer`,
      // `docs/design/05`'s "turnaround buffer"), not a hardcoded number.
      const inventoryUnits = new InventoryUnitRepository(fx.connection);
      const unitId = inventoryUnits.create(ctx, {
        variantId,
        locationId: fx.locationId,
        unitCode: "KAYAK-001",
        trackingMode: "SERIALIZED",
      });
      const reservations = new ReservationRepository(fx.connection);
      const rentalReservations = new RentalReservationService(
        new VariantRepository(fx.connection),
        inventoryUnits,
        reservations,
      );
      const reservationId = rentalReservations.createRentalReservation(ctx, "OWNER", {
        variantId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: "idem-1",
        createdAt: "2026-09-30T00:00:00.000Z",
      });
      const reservation = reservations.findById(ctx, reservationId);
      expect(reservation).toMatchObject({ subjectId: unitId, endsAt: "2026-10-01T10:30:00.000Z" });

      // Deposit applies: an order line carrying exactly the variant's own
      // persisted `depositMinor` drives a real provider hold for that same
      // amount (`DepositAuthorizationService.placeHold` never trusts a
      // caller-supplied amount, `docs/cards/D094.md`).
      const orderRepo = new OrderRepository(fx.connection);
      const paymentRepo = new PaymentRepository(fx.connection);
      const depositRepo = new DepositAuthorizationRepository(fx.connection);
      const provider = new SimulatedDepositHoldProvider(() => new Date("2026-09-08T00:00:00.000Z"), 7);
      const depositService = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, provider);

      const orderId = orderRepo.create(ctx, { customerUserId: fx.userId, status: "CONFIRMED", currency: "USD" });
      const orderLineId = orderRepo.addLine(ctx, orderId, {
        listingId,
        variantId,
        mode: "RENTAL",
        quantity: 1,
        unitPriceMinor: variant.priceMinor,
        lineTotalMinor: variant.priceMinor,
        depositMinor: variant.depositMinor!,
      });

      const holdResult = await depositService.placeHold(ctx, {
        orderLineId,
        connectedAccountId: "acct_123",
        idempotencyKey: "idem-2",
        authorizedAt: "2026-09-08T00:00:00.000Z",
      });
      expect(holdResult.amountMinor).toBe(variant.depositMinor);

      const payment = paymentRepo.findById(ctx, holdResult.paymentId);
      expect(payment).toMatchObject({ kind: "DEPOSIT_HOLD", amountMinor: 20000, currency: "USD" });
    });
  });
});
