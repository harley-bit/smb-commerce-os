import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { detectOverdueReservationsSqlite, type OverdueReservation } from "./LateReturnDetector.js";

const merchantId = generateUuidV7();

async function setup() {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const userId = generateUuidV7();
  await connection.db.insert(sqliteSchema.merchants).values({
    id: merchantId,
    name: "Acme Rentals",
    slug: "acme-rentals",
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  await connection.db.insert(sqliteSchema.users).values({
    id: userId,
    email: "customer@example.com",
    status: "ACTIVE",
    createdAt: "2026-09-08T00:00:00.000Z",
  });

  const ctx = createTenantContext(merchantId);
  const listingRepo = new ListingRepository(connection);
  const variantRepo = new VariantRepository(connection);
  const orderRepo = new OrderRepository(connection);
  const locationRepo = new LocationRepository(connection);
  const unitRepo = new InventoryUnitRepository(connection);
  const reservationRepo = new ReservationRepository(connection);

  const listingId = listingRepo.create(ctx, {
    mode: "RENTAL",
    name: "Trailer",
    slug: "trailer",
    status: "PUBLISHED",
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  const variantId = variantRepo.create(ctx, {
    listingId,
    mode: "RENTAL",
    sku: "TRAILER-1",
    name: "Trailer - default",
    priceMinor: 5000,
    currency: "USD",
    ratePeriod: "DAY",
  });
  const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
  const orderLineId = orderRepo.addLine(ctx, orderId, {
    listingId,
    variantId,
    mode: "RENTAL",
    quantity: 1,
    unitPriceMinor: 5000,
    lineTotalMinor: 5000,
  });

  const locationId = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-1",
    trackingMode: "SERIALIZED",
  });

  function createReservation(state: "IN_USE" | "COMPLETED" | "HELD", startsAt: string, endsAt: string) {
    return reservationRepo.create(ctx, {
      orderLineId,
      subjectType: "INVENTORY_UNIT",
      subjectId: inventoryUnitId,
      startsAt,
      endsAt,
      quantity: 1,
      state,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  }

  return { connection, ctx, orderLineId, userId, createReservation };
}

describe("detectOverdueReservationsSqlite (D081)", () => {
  it("does not detect a reservation whose ends_at has not yet passed", async () => {
    const { connection, createReservation } = await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z");

    const result = detectOverdueReservationsSqlite(connection, "2026-09-05T00:00:00.000Z");

    expect(result.overdueReservationIds).toEqual([]);
  });

  it("detects an IN_USE reservation whose ends_at has passed, without writing any state field", async () => {
    const { connection, ctx, createReservation, orderLineId, userId } = await setup();
    const reservationId = createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z");

    const merchantNotified: OverdueReservation[] = [];
    const customerNotified: OverdueReservation[] = [];
    const result = detectOverdueReservationsSqlite(connection, "2026-09-08T00:00:00.000Z", {
      onMerchantNotify: (r) => merchantNotified.push(r),
      onCustomerNotify: (r) => customerNotified.push(r),
    });

    expect(result.overdueReservationIds).toEqual([reservationId]);

    const reservationRepo = new ReservationRepository(connection);
    expect(reservationRepo.findById(ctx, reservationId)).toMatchObject({ state: "IN_USE" });

    expect(merchantNotified).toHaveLength(1);
    expect(merchantNotified[0]).toMatchObject({
      id: reservationId,
      orderLineId,
      customerUserId: userId,
      endsAt: "2026-09-05T00:00:00.000Z",
    });
    expect(customerNotified).toEqual(merchantNotified);
  });

  it("does not detect a COMPLETED reservation even if ends_at has passed", async () => {
    const { connection, createReservation } = await setup();
    createReservation("COMPLETED", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z");

    const result = detectOverdueReservationsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.overdueReservationIds).toEqual([]);
  });

  it("does not detect a HELD reservation past its ends_at (not yet checked out)", async () => {
    const { connection, createReservation } = await setup();
    createReservation("HELD", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z");

    const result = detectOverdueReservationsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.overdueReservationIds).toEqual([]);
  });

  it("is re-derived on every call: still detects the same overdue reservation on a second run", async () => {
    const { connection, createReservation } = await setup();
    const reservationId = createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z");

    const first = detectOverdueReservationsSqlite(connection, "2026-09-08T00:00:00.000Z");
    const second = detectOverdueReservationsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(first.overdueReservationIds).toEqual([reservationId]);
    expect(second.overdueReservationIds).toEqual([reservationId]);
  });
});
