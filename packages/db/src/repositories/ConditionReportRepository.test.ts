import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";
import { LocationRepository } from "./LocationRepository.js";
import { InventoryUnitRepository } from "./InventoryUnitRepository.js";
import { ConditionReportRepository } from "./ConditionReportRepository.js";

describe("ConditionReportRepository", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let orderRepo: OrderRepository;
  let locationRepo: LocationRepository;
  let unitRepo: InventoryUnitRepository;
  let repo: ConditionReportRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderLineA: string;
  let inventoryUnitA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    locationRepo = new LocationRepository(connection);
    unitRepo = new InventoryUnitRepository(connection);
    repo = new ConditionReportRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    userA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.users).values({
      id: userA,
      email: "a@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const ctxA = createTenantContext(merchantA);
    const listingA = listingRepo.create(ctxA, {
      mode: "RENTAL",
      name: "A Trailer",
      slug: "a-trailer",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantA = variantRepo.create(ctxA, {
      listingId: listingA,
      mode: "RENTAL",
      sku: "A-SKU",
      name: "A Trailer - default",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
    });
    const locationA = locationRepo.create(ctxA, { name: "Main", timezone: "UTC" });
    inventoryUnitA = unitRepo.create(ctxA, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "UNIT-A-1",
      trackingMode: "SERIALIZED",
    });
    const orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
    orderLineA = orderRepo.addLine(ctxA, orderA, {
      listingId: listingA,
      variantId: variantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
  });

  it("create() inserts a CHECKOUT report and hasCheckoutReport() finds it", () => {
    const ctx = createTenantContext(merchantA);

    expect(repo.hasCheckoutReport(ctx, orderLineA)).toBe(false);

    const id = repo.create(ctx, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: "No visible damage.",
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(id).toBeTruthy();
    expect(repo.hasCheckoutReport(ctx, orderLineA)).toBe(true);
  });

  it("hasCheckoutReport() ignores a CHECKIN report for the same order line", () => {
    const ctx = createTenantContext(merchantA);

    repo.create(ctx, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKIN",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-10T09:00:00.000Z",
    });

    expect(repo.hasCheckoutReport(ctx, orderLineA)).toBe(false);
  });

  it("does not let merchant B see merchant A's condition report", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(repo.hasCheckoutReport(ctxB, orderLineA)).toBe(false);
  });

  it("findById() returns the report for the owning merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(repo.findById(ctx, id)).toMatchObject({ id, phase: "CHECKOUT" });
  });

  it("findById() does not let merchant B read merchant A's condition report", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("listByOrderLine() does not let merchant B list merchant A's condition reports", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(repo.listByOrderLine(ctxA, orderLineA)).toHaveLength(1);
    expect(repo.listByOrderLine(ctxB, orderLineA)).toEqual([]);
  });
});
