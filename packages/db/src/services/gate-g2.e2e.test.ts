import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
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
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { verifyAuditChain } from "../audit/verifyChain.js";
import { ListingService } from "./ListingService.js";
import { ProductListingService } from "./ProductListingService.js";
import { VariantService } from "./VariantService.js";
import { InventoryService } from "./InventoryService.js";
import { InventoryUnitService } from "./InventoryUnitService.js";
import { ProductSaleService } from "./ProductSaleService.js";

/**
 * Gate G2 (`docs/design/01`): "a product can be listed, stocked, and sold" —
 * unaided, meaning end-to-end through the real service layer built across
 * D032–D043, with no direct repository/schema access standing in for any
 * step. Every price the test asserts on comes from the server (variant
 * record), never from a value the "buyer" supplies, matching `CLAUDE.md`'s
 * "prices and totals are always recomputed server-side" rule.
 */
describe("Gate G2 — product purchase E2E", () => {
  let connection: Connection;
  let productListingService: ProductListingService;
  let variantService: VariantService;
  let inventoryService: InventoryService;
  let saleService: ProductSaleService;
  let movementRepo: InventoryMovementRepository;
  let auditLogRepo: AuditLogRepository;
  let locationRepo: LocationRepository;
  let merchantA: string;
  let staffUserId: string;
  let locationA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    locationRepo = new LocationRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const unitRepo = new InventoryUnitRepository(connection);
    movementRepo = new InventoryMovementRepository(connection);
    auditLogRepo = new AuditLogRepository(connection);

    productListingService = new ProductListingService(new ListingService(listingRepo));
    variantService = new VariantService(variantRepo);
    inventoryService = new InventoryService(movementRepo, auditLogRepo);
    const unitService = new InventoryUnitService(unitRepo, auditLogRepo);
    const reservationRepo = new ReservationRepository(connection);
    saleService = new ProductSaleService(variantRepo, movementRepo, unitService, auditLogRepo, reservationRepo);

    merchantA = generateUuidV7();
    staffUserId = generateUuidV7();

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
      { id: staffUserId, email: "staff@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    locationA = locationRepo.create(ctx, { name: "Main", timezone: "America/New_York" });
  });

  it("lists, stocks, and sells a product entirely through the service layer", () => {
    const ctx = createTenantContext(merchantA);

    // 1. LISTED — a merchant admin creates a product listing and a priced variant.
    const listingId = productListingService.create(ctx, "ADMIN", {
      name: "Espresso Machine",
      slug: "espresso-machine",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const variantId = variantService.create(ctx, "ADMIN", {
      listingId,
      mode: "PRODUCT",
      sku: "ESP-001",
      name: "Espresso Machine — Standard",
      priceMinor: 24999,
      currency: "USD",
    });

    // 2. STOCKED — a staff member receives real stock into inventory.
    inventoryService.receiveStock(ctx, "ADMIN", {
      variantId,
      locationId: locationA,
      quantity: 10,
      note: "Initial delivery from supplier",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    expect(inventoryService.getStock(ctx, variantId, locationA)).toBe(10);

    // 3. SOLD — a sale is rung up. The buyer's payload carries no price at
    // all; the service reads it exclusively from the variant record.
    const sale = saleService.sellProduct(ctx, "ADMIN", {
      variantId,
      locationId: locationA,
      quantity: 2,
      note: "Register sale #1",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T02:00:00.000Z",
    } as never);

    expect(sale.unitPriceMinor).toBe(24999);
    expect(sale.lineTotalMinor).toBe(49998);
    expect(sale.currency).toBe("USD");

    // Stock is derived from the append-only ledger, never a mutable counter.
    expect(inventoryService.getStock(ctx, variantId, locationA)).toBe(8);

    // A second sale draining the remaining stock still succeeds unaided.
    const secondSale = saleService.sellProduct(ctx, "ADMIN", {
      variantId,
      locationId: locationA,
      quantity: 8,
      note: "Register sale #2 — clears remaining stock",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T03:00:00.000Z",
    });
    expect(secondSale.lineTotalMinor).toBe(199992);
    expect(inventoryService.getStock(ctx, variantId, locationA)).toBe(0);

    // Invariant I5 (stock never negative): a third sale against zero stock is rejected.
    expect(() =>
      saleService.sellProduct(ctx, "ADMIN", {
        variantId,
        locationId: locationA,
        quantity: 1,
        note: "Should be rejected — no stock left",
        actorUserId: staffUserId,
        occurredAt: "2026-09-08T04:00:00.000Z",
      }),
    ).toThrow(InsufficientStockError);

    // Every write along the way (receipt + both sales) is captured in the
    // tamper-evident hash-chained audit log, and the chain verifies clean.
    const verification = verifyAuditChain(ctx, connection);
    expect(verification.valid).toBe(true);
    const actions = auditLogRepo.list(ctx).map((entry) => entry.action);
    expect(actions).toEqual(["inventory.receipt", "inventory.sale", "inventory.sale"]);
  });

  it("rejects a sale where a caller-supplied price would have undercut the server's", () => {
    const ctx = createTenantContext(merchantA);
    const listingId = productListingService.create(ctx, "ADMIN", {
      name: "Cheap Trick",
      slug: "cheap-trick",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantId = variantService.create(ctx, "ADMIN", {
      listingId,
      mode: "PRODUCT",
      sku: "CT-001",
      name: "Cheap Trick — Standard",
      priceMinor: 10000,
      currency: "USD",
    });
    inventoryService.receiveStock(ctx, "ADMIN", {
      variantId,
      locationId: locationA,
      quantity: 1,
      note: "Initial delivery",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T01:00:00.000Z",
    });

    const tampered = {
      variantId,
      locationId: locationA,
      quantity: 1,
      note: "Attempted price tamper",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T02:00:00.000Z",
      priceMinor: 1,
      unitPriceMinor: 1,
    };

    const result = saleService.sellProduct(ctx, "ADMIN", tampered as never);
    expect(result.unitPriceMinor).toBe(10000);
    expect(result.lineTotalMinor).toBe(10000);
  });

  it("a READ_ONLY role cannot stock or sell a product unaided", () => {
    const ctx = createTenantContext(merchantA);
    const listingId = productListingService.create(ctx, "ADMIN", {
      name: "Guarded Item",
      slug: "guarded-item",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantId = variantService.create(ctx, "ADMIN", {
      listingId,
      mode: "PRODUCT",
      sku: "GRD-001",
      name: "Guarded Item — Standard",
      priceMinor: 500,
      currency: "USD",
    });

    expect(() =>
      inventoryService.receiveStock(ctx, "READ_ONLY", {
        variantId,
        locationId: locationA,
        quantity: 5,
        note: "Should be denied",
        actorUserId: staffUserId,
        occurredAt: "2026-09-08T01:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      saleService.sellProduct(ctx, "READ_ONLY", {
        variantId,
        locationId: locationA,
        quantity: 1,
        note: "Should be denied",
        actorUserId: staffUserId,
        occurredAt: "2026-09-08T02:00:00.000Z",
      }),
    ).toThrow();
  });
});
