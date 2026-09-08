import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { ForbiddenActionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { InventoryMovementRepository, InsufficientStockError } from "../repositories/InventoryMovementRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { InventoryUnitService } from "./InventoryUnitService.js";
import { ProductSaleService } from "./ProductSaleService.js";

describe("ProductSaleService", () => {
  let connection: Connection;
  let movementRepo: InventoryMovementRepository;
  let unitRepo: InventoryUnitRepository;
  let variantRepo: VariantRepository;
  let auditLogRepo: AuditLogRepository;
  let service: ProductSaleService;
  let merchantA: string;
  let variantA: string;
  let serviceVariantA: string;
  let locationA: string;
  let userId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const locationRepo = new LocationRepository(connection);
    variantRepo = new VariantRepository(connection);
    unitRepo = new InventoryUnitRepository(connection);
    movementRepo = new InventoryMovementRepository(connection);
    auditLogRepo = new AuditLogRepository(connection);
    const unitService = new InventoryUnitService(unitRepo, auditLogRepo);
    service = new ProductSaleService(variantRepo, movementRepo, unitService, auditLogRepo);

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
      priceMinor: 5000,
      currency: "USD",
    });

    const serviceListingA = listingRepo.create(ctx, {
      mode: "SERVICE",
      name: "A Service Listing",
      slug: "a-service-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    serviceVariantA = variantRepo.create(ctx, {
      listingId: serviceListingA,
      mode: "SERVICE",
      sku: "S-SKU",
      name: "A Service Variant",
      priceMinor: 9000,
      currency: "USD",
      durationMinutes: 60,
    });

    locationA = locationRepo.create(ctx, { name: "Main", timezone: "America/New_York" });
  });

  function receiveStock(ctx: ReturnType<typeof createTenantContext>, quantity: number): void {
    movementRepo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity,
      occurredAt: "2026-09-08T00:30:00.000Z",
      actorUserId: userId,
      note: "Initial stock",
    });
  }

  it("uses the server-side variant price and ignores a client-supplied price", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 3);

    const tamperedInput = {
      variantId: variantA,
      locationId: locationA,
      quantity: 1,
      actorUserId: userId,
      occurredAt: "2026-09-08T01:00:00.000Z",
      note: "Sold at register",
      // A malicious/buggy client payload attempting to override price.
      priceMinor: 1,
      unitPriceMinor: 1,
    };

    const result = service.sellProduct(ctx, "ADMIN", tamperedInput as never);

    expect(result.unitPriceMinor).toBe(5000);
    expect(result.lineTotalMinor).toBe(5000);
    expect(result.currency).toBe("USD");
    expect(movementRepo.sumStock(ctx, variantA, locationA)).toBe(2);
  });

  it("computes lineTotalMinor from quantity times the server price", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 5);

    const result = service.sellProduct(ctx, "ADMIN", {
      variantId: variantA,
      locationId: locationA,
      quantity: 3,
      actorUserId: userId,
      occurredAt: "2026-09-08T01:00:00.000Z",
      note: "Sold at register",
    });

    expect(result.unitPriceMinor).toBe(5000);
    expect(result.lineTotalMinor).toBe(15000);
  });

  it("throws InsufficientStockError instead of selling below zero stock", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 1);

    expect(() =>
      service.sellProduct(ctx, "ADMIN", {
        variantId: variantA,
        locationId: locationA,
        quantity: 2,
        actorUserId: userId,
        occurredAt: "2026-09-08T01:00:00.000Z",
        note: "Sold at register",
      }),
    ).toThrow(InsufficientStockError);
  });

  it("transitions the serialized unit to SOLD when a unitId is supplied", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 1);
    const unitId = unitRepo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "SN-001",
      trackingMode: "SERIALIZED",
    });

    service.sellProduct(ctx, "ADMIN", {
      variantId: variantA,
      unitId,
      locationId: locationA,
      quantity: 1,
      actorUserId: userId,
      occurredAt: "2026-09-08T01:00:00.000Z",
      note: "Sold at register",
    });

    expect(unitRepo.findById(ctx, unitId)).toMatchObject({ status: "SOLD" });
  });

  it("rejects a sale for a non-PRODUCT variant", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.sellProduct(ctx, "ADMIN", {
        variantId: serviceVariantA,
        locationId: locationA,
        quantity: 1,
        actorUserId: userId,
        occurredAt: "2026-09-08T01:00:00.000Z",
        note: "Not a product",
      }),
    ).toThrow(/PRODUCT/);
  });

  it("rejects a caller without inventory:manage", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 3);

    expect(() =>
      service.sellProduct(ctx, "STAFF", {
        variantId: variantA,
        locationId: locationA,
        quantity: 1,
        actorUserId: userId,
        occurredAt: "2026-09-08T01:00:00.000Z",
        note: "Sold at register",
      }),
    ).toThrow(ForbiddenActionError);

    expect(movementRepo.sumStock(ctx, variantA, locationA)).toBe(3);
  });

  it("audit-logs the sale with the server-computed price, not any client-supplied value", () => {
    const ctx = createTenantContext(merchantA);
    receiveStock(ctx, 2);

    service.sellProduct(
      ctx,
      "ADMIN",
      {
        variantId: variantA,
        locationId: locationA,
        quantity: 1,
        actorUserId: userId,
        occurredAt: "2026-09-08T01:00:00.000Z",
        note: "Sold at register",
        priceMinor: 1,
      } as never,
    );

    const entries = auditLogRepo.list(ctx);
    const saleEntry = entries.find((entry) => entry.action === "inventory.sale");
    expect(saleEntry).toBeDefined();
    const after = JSON.parse(saleEntry?.afterJson ?? "{}") as { unitPriceMinor: number };
    expect(after.unitPriceMinor).toBe(5000);
  });
});
