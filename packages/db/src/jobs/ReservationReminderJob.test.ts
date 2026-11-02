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
import { detectUpcomingReservationsSqlite, type UpcomingReservation } from "./ReservationReminderJob.js";

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

  function createReservation(
    state: "HELD" | "CONFIRMED" | "IN_USE" | "COMPLETED",
    startsAt: string,
    endsAt: string,
  ) {
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

describe("detectUpcomingReservationsSqlite (D134)", () => {
  it("detects a CONFIRMED reservation starting within the reminder window", async () => {
    const { connection, createReservation, orderLineId, userId } = await setup();
    const reservationId = createReservation("CONFIRMED", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

    const notified: UpcomingReservation[] = [];
    const result = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24, {
      onCustomerNotify: (r) => notified.push(r),
    });

    expect(result.upcomingReservationIds).toEqual([reservationId]);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      id: reservationId,
      orderLineId,
      customerUserId: userId,
      startsAt: "2026-09-10T00:00:00.000Z",
    });
  });

  it("does not detect a reservation starting further out than the window", async () => {
    const { connection, createReservation } = await setup();
    createReservation("CONFIRMED", "2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z");

    const result = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.upcomingReservationIds).toEqual([]);
  });

  it("does not detect a reservation that has already started", async () => {
    const { connection, createReservation } = await setup();
    createReservation("CONFIRMED", "2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z");

    const result = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.upcomingReservationIds).toEqual([]);
  });

  it("does not detect a HELD reservation (not yet confirmed)", async () => {
    const { connection, createReservation } = await setup();
    createReservation("HELD", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

    const result = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.upcomingReservationIds).toEqual([]);
  });

  it("does not detect an IN_USE reservation (already checked out)", async () => {
    const { connection, createReservation } = await setup();
    createReservation("IN_USE", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

    const result = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.upcomingReservationIds).toEqual([]);
  });

  it("is re-derived on every call: still detects the same upcoming reservation on a second run", async () => {
    const { connection, createReservation } = await setup();
    const reservationId = createReservation("CONFIRMED", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

    const first = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);
    const second = detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(first.upcomingReservationIds).toEqual([reservationId]);
    expect(second.upcomingReservationIds).toEqual([reservationId]);
  });
});
