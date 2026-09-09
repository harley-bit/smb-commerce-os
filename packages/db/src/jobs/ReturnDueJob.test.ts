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
import { detectReturnsDueSqlite, type ReturnDueReservation } from "./ReturnDueJob.js";

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

describe("detectReturnsDueSqlite (D134)", () => {
  it("detects an IN_USE reservation whose ends_at falls within the due-soon window", async () => {
    const { connection, createReservation, orderLineId, userId } = await setup();
    const reservationId = createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z");

    const notified: ReturnDueReservation[] = [];
    const result = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24, {
      onCustomerNotify: (r) => notified.push(r),
    });

    expect(result.returnDueReservationIds).toEqual([reservationId]);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      id: reservationId,
      orderLineId,
      customerUserId: userId,
      endsAt: "2026-09-10T00:00:00.000Z",
    });
  });

  it("does not detect a reservation already overdue (ends_at in the past)", async () => {
    const { connection, createReservation } = await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z");

    const result = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.returnDueReservationIds).toEqual([]);
  });

  it("does not detect a reservation ending further out than the window", async () => {
    const { connection, createReservation } = await setup();
    createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-20T00:00:00.000Z");

    const result = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.returnDueReservationIds).toEqual([]);
  });

  it("does not detect a COMPLETED reservation even if ends_at falls within the window", async () => {
    const { connection, createReservation } = await setup();
    createReservation("COMPLETED", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z");

    const result = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(result.returnDueReservationIds).toEqual([]);
  });

  it("is re-derived on every call: still detects the same due reservation on a second run", async () => {
    const { connection, createReservation } = await setup();
    const reservationId = createReservation("IN_USE", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z");

    const first = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24);
    const second = detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24);

    expect(first.returnDueReservationIds).toEqual([reservationId]);
    expect(second.returnDueReservationIds).toEqual([reservationId]);
  });
});
