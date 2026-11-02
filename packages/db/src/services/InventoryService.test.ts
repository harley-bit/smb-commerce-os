import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { InventoryMovementRepository } from "../repositories/InventoryMovementRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { InventoryService } from "./InventoryService.js";

describe("InventoryService", () => {
  let connection: Connection;
  let service: InventoryService;
  let auditLogRepo: AuditLogRepository;
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
    auditLogRepo = new AuditLogRepository(connection);
    service = new InventoryService(new InventoryMovementRepository(connection), auditLogRepo);

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

  it("records a RECEIPT and reflects it in stock", () => {
    const ctx = createTenantContext(merchantA);

    service.receiveStock(ctx, "ADMIN", {
      variantId: variantA,
      locationId: locationA,
      quantity: 25,
      note: "Initial delivery from supplier",
      actorUserId: userId,
      occurredAt: "2026-09-08T00:00:00.000Z",
    });

    expect(service.getStock(ctx, variantA)).toBe(25);
  });

  it("stock reflects a receipt on top of prior mixed-kind movements", () => {
    const ctx = createTenantContext(merchantA);
    const movementRepo = new InventoryMovementRepository(connection);
    movementRepo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "SALE",
      quantity: -2,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "Pre-existing sale",
    });

    service.receiveStock(ctx, "ADMIN", {
      variantId: variantA,
      locationId: locationA,
      quantity: 10,
      note: "Restock",
      actorUserId: userId,
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(service.getStock(ctx, variantA)).toBe(8);
  });

  it("STAFF cannot receive stock — inventory:manage is ADMIN/OWNER only", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.receiveStock(ctx, "STAFF", {
        variantId: variantA,
        locationId: locationA,
        quantity: 10,
        note: "Restock",
        actorUserId: userId,
        occurredAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/not permitted/i);
    expect(service.getStock(ctx, variantA)).toBe(0);
  });

  it("READ_ONLY cannot receive stock", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.receiveStock(ctx, "READ_ONLY", {
        variantId: variantA,
        locationId: locationA,
        quantity: 10,
        note: "Restock",
        actorUserId: userId,
        occurredAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/not permitted/i);
  });

  it("rejects a RECEIPT with a non-positive quantity", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.receiveStock(ctx, "OWNER", {
        variantId: variantA,
        locationId: locationA,
        quantity: 0,
        note: "Restock",
        actorUserId: userId,
        occurredAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/positive/i);
  });

  it("rejects a RECEIPT with a blank note — every movement must carry a reason", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.receiveStock(ctx, "OWNER", {
        variantId: variantA,
        locationId: locationA,
        quantity: 5,
        note: "   ",
        actorUserId: userId,
        occurredAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/reason|note/i);
  });

  it("this card's security check: a receipt is audit-logged with its reason", () => {
    const ctx = createTenantContext(merchantA);

    const movementId = service.receiveStock(ctx, "OWNER", {
      variantId: variantA,
      locationId: locationA,
      quantity: 15,
      note: "Initial delivery from supplier",
      actorUserId: userId,
      occurredAt: "2026-09-08T00:00:00.000Z",
    });

    const entries = auditLogRepo.list(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      merchantId: merchantA,
      actorType: "USER",
      actorId: userId,
      action: "inventory.receipt",
      entityType: "inventory_movements",
      entityId: movementId,
    });
    expect(JSON.parse(entries[0]!.afterJson ?? "{}")).toMatchObject({
      quantity: 15,
      note: "Initial delivery from supplier",
    });
  });
});
