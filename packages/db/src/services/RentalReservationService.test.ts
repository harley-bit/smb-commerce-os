import { createTenantContext, generateUuidV7, ForbiddenActionError, NoAvailableUnitError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import {
  MissingIdempotencyKeyError,
  RentalReservationService,
  VariantNotRentalError,
} from "./RentalReservationService.js";

describe("RentalReservationService", () => {
  let connection: Connection;
  let service: RentalReservationService;
  let merchantA: string;
  let locationA: string;
  let listingA: string;
  let rentalVariant: string;
  let unit1: string;
  let unit2: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    service = new RentalReservationService(
      new VariantRepository(connection),
      new InventoryUnitRepository(connection),
      new ReservationRepository(connection),
    );

    merchantA = generateUuidV7();
    locationA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.locations).values({
      id: locationA,
      merchantId: merchantA,
      name: "A Shop",
      timezone: "America/Los_Angeles",
    });

    listingA = generateUuidV7();
    await connection.db.insert(sqliteSchema.listings).values({
      id: listingA,
      merchantId: merchantA,
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const variantRepo = new VariantRepository(connection);
    const ctx = createTenantContext(merchantA);
    rentalVariant = variantRepo.create(ctx, {
      listingId: listingA,
      mode: "RENTAL",
      sku: "KAYAK-1",
      name: "Single kayak",
      priceMinor: 5000,
      currency: "USD",
      bufferMinutes: 30,
    });

    const unitRepo = new InventoryUnitRepository(connection);
    unit1 = unitRepo.create(ctx, {
      variantId: rentalVariant,
      locationId: locationA,
      unitCode: "KAYAK-001",
      trackingMode: "SERIALIZED",
    });
    unit2 = unitRepo.create(ctx, {
      variantId: rentalVariant,
      locationId: locationA,
      unitCode: "KAYAK-002",
      trackingMode: "SERIALIZED",
    });
  });

  it("createRentalReservation() allocates a free serialized unit (D066 acceptance)", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-1",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const reservationRepo = new ReservationRepository(connection);
    const row = reservationRepo.findById(ctx, id);
    expect(row).toMatchObject({ subjectType: "INVENTORY_UNIT", state: "HELD" });
    expect([unit1, unit2]).toContain(row?.subjectId);
  });

  it("createRentalReservation() picks the other free unit once the first is occupied for an overlapping window (allocator picks a free unit)", () => {
    const ctx = createTenantContext(merchantA);

    const firstId = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-1",
      createdAt: "2026-10-01T08:45:00.000Z",
    });
    const reservationRepo = new ReservationRepository(connection);
    const firstUnit = reservationRepo.findById(ctx, firstId)?.subjectId;

    const secondId = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:30:00.000Z",
      endsAt: "2026-10-01T10:30:00.000Z",
      idempotencyKey: "idem-2",
      createdAt: "2026-10-01T08:46:00.000Z",
    });
    const secondUnit = reservationRepo.findById(ctx, secondId)?.subjectId;

    expect(secondUnit).not.toEqual(firstUnit);
    expect([unit1, unit2]).toContain(secondUnit);
  });

  it("createRentalReservation() rejects once both units are occupied for the overlapping window (conflict rejected)", () => {
    const ctx = createTenantContext(merchantA);

    service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-1",
      createdAt: "2026-10-01T08:45:00.000Z",
    });
    service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-2",
      createdAt: "2026-10-01T08:46:00.000Z",
    });

    expect(() =>
      service.createRentalReservation(ctx, "STAFF", {
        variantId: rentalVariant,
        startsAt: "2026-10-01T09:30:00.000Z",
        endsAt: "2026-10-01T10:30:00.000Z",
        idempotencyKey: "idem-3",
        createdAt: "2026-10-01T08:47:00.000Z",
      }),
    ).toThrow(NoAvailableUnitError);
  });

  it("security: createRentalReservation() requires an Idempotency-Key", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.createRentalReservation(ctx, "STAFF", {
        variantId: rentalVariant,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: "",
        createdAt: "2026-10-01T08:45:00.000Z",
      }),
    ).toThrow(MissingIdempotencyKeyError);
  });

  it("security: retrying createRentalReservation() with the same Idempotency-Key replays the original reservation instead of allocating a second unit", () => {
    const ctx = createTenantContext(merchantA);

    const firstId = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-retry",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const secondId = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-retry",
      createdAt: "2026-10-01T08:45:05.000Z",
    });

    expect(secondId).toEqual(firstId);
  });

  it("createRentalReservation() applies the variant's buffer minutes to the stored reservation (reuses D064 buffer expansion)", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.createRentalReservation(ctx, "STAFF", {
      variantId: rentalVariant,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "idem-buffer",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const reservationRepo = new ReservationRepository(connection);
    const row = reservationRepo.findById(ctx, id);
    expect(row?.bufferMinutes).toEqual(30);
    expect(row?.endsAt).toEqual("2026-10-01T10:30:00.000Z");
  });

  it("rejects a non-RENTAL variant", () => {
    const ctx = createTenantContext(merchantA);
    const variantRepo = new VariantRepository(connection);
    const serviceVariant = variantRepo.create(ctx, {
      listingId: listingA,
      mode: "SERVICE",
      sku: "SVC-1",
      name: "Guided tour",
      priceMinor: 2000,
      currency: "USD",
      durationMinutes: 60,
    });

    expect(() =>
      service.createRentalReservation(ctx, "STAFF", {
        variantId: serviceVariant,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: "idem-svc",
        createdAt: "2026-10-01T08:45:00.000Z",
      }),
    ).toThrow(VariantNotRentalError);
  });

  describe("authorization — rental reservation creation restricted to roles with bookings:manage", () => {
    it("is forbidden for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      expect(() =>
        service.createRentalReservation(ctx, "READ_ONLY", {
          variantId: rentalVariant,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          idempotencyKey: "idem-ro",
          createdAt: "2026-10-01T08:45:00.000Z",
        }),
      ).toThrow(ForbiddenActionError);
    });
  });
});
