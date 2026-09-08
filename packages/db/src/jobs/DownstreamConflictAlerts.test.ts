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
import { detectDownstreamConflictsSqlite, type DownstreamConflictAlert } from "./DownstreamConflictAlerts.js";

const merchantId = generateUuidV7();

async function setup() {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const overdueCustomerId = generateUuidV7();
  const affectedCustomerId = generateUuidV7();
  await connection.db.insert(sqliteSchema.merchants).values({
    id: merchantId,
    name: "Acme Rentals",
    slug: "acme-rentals",
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  await connection.db.insert(sqliteSchema.users).values([
    { id: overdueCustomerId, email: "late-customer@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    { id: affectedCustomerId, email: "next-customer@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
  ]);

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

  function createOrderLine(customerUserId: string) {
    const orderId = orderRepo.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    return orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
  }

  const locationId = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-1",
    trackingMode: "SERIALIZED",
  });
  const otherUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-2",
    trackingMode: "SERIALIZED",
  });

  function createReservation(
    state: "IN_USE" | "COMPLETED" | "HELD" | "CONFIRMED",
    startsAt: string,
    endsAt: string,
    subjectId: string,
    customerUserId: string,
  ) {
    const orderLineId = createOrderLine(customerUserId);
    return reservationRepo.create(ctx, {
      orderLineId,
      subjectType: "INVENTORY_UNIT",
      subjectId,
      startsAt,
      endsAt,
      quantity: 1,
      state,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  }

  return { connection, ctx, overdueCustomerId, affectedCustomerId, inventoryUnitId, otherUnitId, createReservation };
}

describe("detectDownstreamConflictsSqlite (D082)", () => {
  it("raises no alert when there is no overdue reservation", async () => {
    const { connection, createReservation, inventoryUnitId, affectedCustomerId } = await setup();
    createReservation("HELD", "2026-09-10T00:00:00.000Z", "2026-09-12T00:00:00.000Z", inventoryUnitId, affectedCustomerId);

    const result = detectDownstreamConflictsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.alerts).toEqual([]);
  });

  it("raises no alert when an overdue reservation's unit has no future booking", async () => {
    const { connection, createReservation, inventoryUnitId, overdueCustomerId } = await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z", inventoryUnitId, overdueCustomerId);

    const result = detectDownstreamConflictsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.alerts).toEqual([]);
  });

  it("names the specific affected booking and contact when a future booking exists on the same overdue unit", async () => {
    const { connection, createReservation, inventoryUnitId, overdueCustomerId, affectedCustomerId } = await setup();
    const overdueId = createReservation(
      "IN_USE",
      "2026-09-01T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
      inventoryUnitId,
      overdueCustomerId,
    );
    const affectedId = createReservation(
      "CONFIRMED",
      "2026-09-10T00:00:00.000Z",
      "2026-09-12T00:00:00.000Z",
      inventoryUnitId,
      affectedCustomerId,
    );

    const alertsRaised: DownstreamConflictAlert[] = [];
    const result = detectDownstreamConflictsSqlite(connection, "2026-09-08T00:00:00.000Z", {
      onConflictAlert: (alert) => alertsRaised.push(alert),
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      overdueReservationId: overdueId,
      affectedReservationId: affectedId,
      affectedStartsAt: "2026-09-10T00:00:00.000Z",
      affectedCustomerUserId: affectedCustomerId,
      affectedContactEmail: "next-customer@example.com",
    });
    expect(alertsRaised).toEqual(result.alerts);
  });

  it("does not alert on a future booking for a different unit", async () => {
    const { connection, createReservation, inventoryUnitId, otherUnitId, overdueCustomerId, affectedCustomerId } =
      await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z", inventoryUnitId, overdueCustomerId);
    createReservation("CONFIRMED", "2026-09-10T00:00:00.000Z", "2026-09-12T00:00:00.000Z", otherUnitId, affectedCustomerId);

    const result = detectDownstreamConflictsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.alerts).toEqual([]);
  });

  it("does not alert on a future booking that has already been cancelled", async () => {
    const { connection, createReservation, inventoryUnitId, overdueCustomerId, affectedCustomerId } = await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z", inventoryUnitId, overdueCustomerId);
    createReservation("HELD", "2026-09-10T00:00:00.000Z", "2026-09-12T00:00:00.000Z", inventoryUnitId, affectedCustomerId);
    const reservationRepo = new ReservationRepository(connection);
    const cancelled = createReservation(
      "HELD",
      "2026-09-14T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
      inventoryUnitId,
      affectedCustomerId,
    );
    reservationRepo.cancel(createTenantContext(merchantId), cancelled, "2026-09-08T00:00:00.000Z");

    const result = detectDownstreamConflictsSqlite(connection, "2026-09-08T00:00:00.000Z");

    expect(result.alerts.map((a) => a.affectedReservationId)).not.toContain(cancelled);
  });
});
