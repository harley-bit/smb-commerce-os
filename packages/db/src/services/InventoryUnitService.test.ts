import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { InventoryUnitService, InvalidUnitStatusTransitionError } from "./InventoryUnitService.js";

describe("InventoryUnitService", () => {
  let connection: Connection;
  let unitRepo: InventoryUnitRepository;
  let auditLogRepo: AuditLogRepository;
  let service: InventoryUnitService;
  let merchantA: string;
  let variantA: string;
  let locationA: string;
  let userId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const locationRepo = new LocationRepository(connection);
    unitRepo = new InventoryUnitRepository(connection);
    auditLogRepo = new AuditLogRepository(connection);
    service = new InventoryUnitService(unitRepo, auditLogRepo);

    merchantA = generateUuidV7();
    userId = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userId, email: "staff@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    const listingA = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "A Listing",
      slug: "a-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantA = variantRepo.create(ctx, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 1000,
      currency: "USD",
    });
    locationA = locationRepo.create(ctx, { name: "Main", timezone: "America/New_York" });
  });

  function createUnit(ctx: ReturnType<typeof createTenantContext>): string {
    return unitRepo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "SN-001",
      trackingMode: "SERIALIZED",
    });
  }

  it("allows AVAILABLE -> SOLD", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "SOLD",
      actorUserId: userId,
      note: "Sold at checkout",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(unitRepo.findById(ctx, id)).toMatchObject({ status: "SOLD" });
  });

  it("allows AVAILABLE -> RETIRED", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "RETIRED",
      actorUserId: userId,
      note: "End of life",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(unitRepo.findById(ctx, id)).toMatchObject({ status: "RETIRED" });
  });

  it("rejects a transition out of SOLD — terminal state", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "SOLD",
      actorUserId: userId,
      note: "Sold at checkout",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(() =>
      service.transitionStatus(ctx, "ADMIN", {
        unitId: id,
        newStatus: "AVAILABLE",
        actorUserId: userId,
        note: "Attempted un-sell",
        occurredAt: "2026-09-08T02:00:00.000Z",
      }),
    ).toThrow(InvalidUnitStatusTransitionError);

    expect(unitRepo.findById(ctx, id)).toMatchObject({ status: "SOLD" });
  });

  it("rejects a transition out of RETIRED — terminal state", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "RETIRED",
      actorUserId: userId,
      note: "End of life",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(() =>
      service.transitionStatus(ctx, "ADMIN", {
        unitId: id,
        newStatus: "AVAILABLE",
        actorUserId: userId,
        note: "Attempted revival",
        occurredAt: "2026-09-08T02:00:00.000Z",
      }),
    ).toThrow(InvalidUnitStatusTransitionError);
  });

  it("rejects an unrecognized transition (e.g. SOLD directly to RETIRED)", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "SOLD",
      actorUserId: userId,
      note: "Sold",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(() =>
      service.transitionStatus(ctx, "ADMIN", {
        unitId: id,
        newStatus: "RETIRED",
        actorUserId: userId,
        note: "Retire a sold unit",
        occurredAt: "2026-09-08T02:00:00.000Z",
      }),
    ).toThrow(InvalidUnitStatusTransitionError);
  });

  it("STAFF cannot transition unit status — inventory:manage is ADMIN/OWNER only", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    expect(() =>
      service.transitionStatus(ctx, "STAFF", {
        unitId: id,
        newStatus: "SOLD",
        actorUserId: userId,
        note: "Sold at checkout",
        occurredAt: "2026-09-08T01:00:00.000Z",
      }),
    ).toThrow(/not permitted/i);
    expect(unitRepo.findById(ctx, id)).toMatchObject({ status: "AVAILABLE" });
  });

  it("throws for an unknown unit id", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.transitionStatus(ctx, "ADMIN", {
        unitId: generateUuidV7(),
        newStatus: "SOLD",
        actorUserId: userId,
        note: "Sold at checkout",
        occurredAt: "2026-09-08T01:00:00.000Z",
      }),
    ).toThrow(/not found/i);
  });

  it("this card's security check: every status change is audit-logged", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "SOLD",
      actorUserId: userId,
      note: "Sold at checkout",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    const entries = auditLogRepo.list(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      merchantId: merchantA,
      actorType: "USER",
      actorId: userId,
      action: "inventory_unit.status_changed",
      entityType: "inventory_units",
      entityId: id,
    });
    expect(JSON.parse(entries[0]!.beforeJson ?? "{}")).toMatchObject({ status: "AVAILABLE" });
    expect(JSON.parse(entries[0]!.afterJson ?? "{}")).toMatchObject({ status: "SOLD", note: "Sold at checkout" });
  });

  it("a rejected transition does not write an audit log entry", () => {
    const ctx = createTenantContext(merchantA);
    const id = createUnit(ctx);

    service.transitionStatus(ctx, "ADMIN", {
      unitId: id,
      newStatus: "SOLD",
      actorUserId: userId,
      note: "Sold",
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(() =>
      service.transitionStatus(ctx, "ADMIN", {
        unitId: id,
        newStatus: "AVAILABLE",
        actorUserId: userId,
        note: "Attempted un-sell",
        occurredAt: "2026-09-08T02:00:00.000Z",
      }),
    ).toThrow(InvalidUnitStatusTransitionError);

    expect(auditLogRepo.list(ctx)).toHaveLength(1);
  });

  it("is tenant-scoped — cannot transition another merchant's unit", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(generateUuidV7());
    const id = createUnit(ctxA);

    expect(() =>
      service.transitionStatus(ctxB, "ADMIN", {
        unitId: id,
        newStatus: "SOLD",
        actorUserId: userId,
        note: "Cross-tenant attempt",
        occurredAt: "2026-09-08T01:00:00.000Z",
      }),
    ).toThrow(/not found/i);

    expect(unitRepo.findById(ctxA, id)).toMatchObject({ status: "AVAILABLE" });
  });

  describe("create()", () => {
    it("creates a unit and captures acquisition data", () => {
      const ctx = createTenantContext(merchantA);

      const id = service.create(ctx, "ADMIN", {
        variantId: variantA,
        locationId: locationA,
        unitCode: "SN-100",
        trackingMode: "SERIALIZED",
        acquisitionCostMinor: 500000,
        acquiredAt: "2026-09-08T00:00:00.000Z",
      });

      expect(unitRepo.findById(ctx, id)).toMatchObject({
        unitCode: "SN-100",
        status: "AVAILABLE",
        acquisitionCostMinor: 500000,
        acquiredAt: "2026-09-08T00:00:00.000Z",
      });
    });

    it("STAFF cannot create a unit — inventory:manage is ADMIN/OWNER only", () => {
      const ctx = createTenantContext(merchantA);

      expect(() =>
        service.create(ctx, "STAFF", {
          variantId: variantA,
          locationId: locationA,
          unitCode: "SN-101",
          trackingMode: "SERIALIZED",
          acquisitionCostMinor: 500000,
          acquiredAt: "2026-09-08T00:00:00.000Z",
        }),
      ).toThrow(/not permitted/i);
    });
  });

  describe("update()", () => {
    it("patches unitCode/expectedLifeMonths/conditionGrade", () => {
      const ctx = createTenantContext(merchantA);
      const id = createUnit(ctx);

      service.update(ctx, "ADMIN", id, { unitCode: "SN-001-RELABELED", conditionGrade: "B" });

      expect(unitRepo.findById(ctx, id)).toMatchObject({ unitCode: "SN-001-RELABELED", conditionGrade: "B" });
    });

    it("STAFF cannot edit a unit — inventory:manage is ADMIN/OWNER only", () => {
      const ctx = createTenantContext(merchantA);
      const id = createUnit(ctx);

      expect(() => service.update(ctx, "STAFF", id, { unitCode: "HIJACKED" })).toThrow(/not permitted/i);
      expect(unitRepo.findById(ctx, id)).toMatchObject({ unitCode: "SN-001" });
    });

    it("throws for an unknown unit id", () => {
      const ctx = createTenantContext(merchantA);

      expect(() => service.update(ctx, "ADMIN", generateUuidV7(), { unitCode: "X" })).toThrow(/not found/i);
    });

    it("is tenant-scoped — cannot edit another merchant's unit", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(generateUuidV7());
      const id = createUnit(ctxA);

      expect(() => service.update(ctxB, "ADMIN", id, { unitCode: "HIJACKED" })).toThrow(/not found/i);
      expect(unitRepo.findById(ctxA, id)).toMatchObject({ unitCode: "SN-001" });
    });
  });
});
