import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { ResourceRepository } from "../repositories/ResourceRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { CalendarService } from "./CalendarService.js";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

describe("CalendarService", () => {
  let connection: Connection;
  let service: CalendarService;
  let reservations: ReservationRepository;
  let merchantA: string;
  let locationA: string;
  let resourceA: string;
  let rentalUnitA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    reservations = new ReservationRepository(connection);
    service = new CalendarService(
      reservations,
      new ResourceRepository(connection),
      new InventoryUnitRepository(connection),
    );

    merchantA = generateUuidV7();
    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: CREATED_AT,
    });

    locationA = generateUuidV7();
    await connection.db.insert(sqliteSchema.locations).values({
      id: locationA,
      merchantId: merchantA,
      name: "Main",
      timezone: "UTC",
    });

    const ctx = createTenantContext(merchantA);
    const resources = new ResourceRepository(connection);
    resourceA = resources.create(ctx, { locationId: locationA, kind: "STAFF", name: "Jane", capacity: 1 });

    const listingId = generateUuidV7();
    await connection.db.insert(sqliteSchema.listings).values({
      id: listingId,
      merchantId: merchantA,
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "DRAFT",
      createdAt: CREATED_AT,
    });
    const variantRepo = new VariantRepository(connection);
    const rentalVariant = variantRepo.create(ctx, {
      listingId,
      mode: "RENTAL",
      sku: "KAYAK-1",
      name: "Single kayak",
      priceMinor: 5000,
      currency: "USD",
      bufferMinutes: 0,
    });
    const unitRepo = new InventoryUnitRepository(connection);
    rentalUnitA = unitRepo.create(ctx, {
      variantId: rentalVariant,
      locationId: locationA,
      unitCode: "KAYAK-001",
      trackingMode: "SERIALIZED",
    });
  });

  it("returns both RESOURCE bookings and INVENTORY_UNIT rentals on one calendar, with a resolved label", () => {
    const ctx = createTenantContext(merchantA);
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });
    reservations.createGuarded(ctx, {
      subjectType: "INVENTORY_UNIT",
      subjectId: rentalUnitA,
      startsAt: "2026-10-01T11:00:00.000Z",
      endsAt: "2026-10-01T12:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: CREATED_AT,
    });

    const entries = service.getCalendar(ctx, "STAFF", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");

    expect(entries).toHaveLength(2);
    const bySubject = new Map(entries.map((e) => [e.subjectType, e]));
    expect(bySubject.get("RESOURCE")).toMatchObject({ subjectLabel: "Jane", hasConflict: false, expiresAt: null });
    expect(bySubject.get("INVENTORY_UNIT")).toMatchObject({
      subjectLabel: "KAYAK-001",
      hasConflict: false,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("flags overlapping reservations for the same subject as conflicts", () => {
    const ctx = createTenantContext(merchantA);
    // Bypass the write-time conflict guard (`createGuarded`) to model data
    // that shouldn't exist under normal operation — the calendar should
    // still surface it defensively rather than assume it can't happen.
    const first = reservations.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });
    const second = reservations.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:30:00.000Z",
      endsAt: "2026-10-01T10:30:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const entries = service.getCalendar(ctx, "STAFF", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");

    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get(first)?.hasConflict).toBe(true);
    expect(byId.get(second)?.hasConflict).toBe(true);
  });

  it("does not flag a completed reservation followed by a later confirmed one for the same subject as a conflict", () => {
    const ctx = createTenantContext(merchantA);
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "COMPLETED",
      createdAt: CREATED_AT,
    });
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T14:00:00.000Z",
      endsAt: "2026-10-01T15:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const entries = service.getCalendar(ctx, "STAFF", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");

    expect(entries.every((e) => !e.hasConflict)).toBe(true);
  });

  it("READ_ONLY can view the calendar (bookings:view is granted to every role)", () => {
    const ctx = createTenantContext(merchantA);
    const entries = service.getCalendar(ctx, "READ_ONLY", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
    expect(entries).toEqual([]);
  });

  it("is tenant-scoped — merchant B never sees merchant A's calendar entries", () => {
    const merchantB = generateUuidV7();
    const ctxB = createTenantContext(merchantB);
    const ctxA = createTenantContext(merchantA);
    reservations.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const entries = service.getCalendar(ctxB, "STAFF", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
    expect(entries).toEqual([]);
  });
});
