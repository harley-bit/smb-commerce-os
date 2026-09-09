import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ConditionReportRepository } from "../repositories/ConditionReportRepository.js";
import { OrderLineNotFoundError } from "./FulfillmentEventService.js";
import { ConditionReportService, MissingCheckoutBaselineError } from "./ConditionReportService.js";

describe("ConditionReportService", () => {
  let connection: Connection;
  let conditionReports: ConditionReportRepository;
  let orderRepo: OrderRepository;
  let service: ConditionReportService;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderLineA: string;
  let inventoryUnitA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    const locationRepo = new LocationRepository(connection);
    const unitRepo = new InventoryUnitRepository(connection);
    conditionReports = new ConditionReportRepository(connection);
    service = new ConditionReportService(conditionReports, orderRepo);

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
    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantB,
      name: "Merchant B",
      slug: "merchant-b",
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

  it("recordCheckout() writes a CHECKOUT report and returns it — docs/cards/D116.md", () => {
    const ctx = createTenantContext(merchantA);

    const report = service.recordCheckout(ctx, "STAFF", {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      conditionGrade: "GOOD",
      notes: "No visible damage at pickup.",
      createdBy: userA,
      createdAt: "2026-09-10T08:55:00.000Z",
    });

    expect(report.phase).toBe("CHECKOUT");
    expect(report.conditionGrade).toBe("GOOD");
    expect(conditionReports.hasCheckoutReport(ctx, orderLineA)).toBe(true);
  });

  it("recordCheckout() rejects when the acting role lacks bookings:manage", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.recordCheckout(ctx, "READ_ONLY", {
        orderLineId: orderLineA,
        inventoryUnitId: inventoryUnitA,
        conditionGrade: "GOOD",
        createdBy: userA,
        createdAt: "2026-09-10T08:55:00.000Z",
      }),
    ).toThrow();
    expect(conditionReports.hasCheckoutReport(ctx, orderLineA)).toBe(false);
  });

  it("recordCheckout() rejects an order line that doesn't belong to the caller's merchant — tenant isolation (G1)", () => {
    const ctxB = createTenantContext(merchantB);

    expect(() =>
      service.recordCheckout(ctxB, "OWNER", {
        orderLineId: orderLineA,
        inventoryUnitId: inventoryUnitA,
        conditionGrade: "GOOD",
        createdBy: userA,
        createdAt: "2026-09-10T08:55:00.000Z",
      }),
    ).toThrow(OrderLineNotFoundError);
  });

  it("recordCheckin() rejects a CHECKIN with no CHECKOUT baseline on record", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.recordCheckin(ctx, "OWNER", {
        orderLineId: orderLineA,
        inventoryUnitId: inventoryUnitA,
        conditionGrade: "FAIR",
        notes: "Scuffed.",
        createdBy: userA,
        createdAt: "2026-09-10T09:00:00.000Z",
      }),
    ).toThrow(MissingCheckoutBaselineError);
  });

  it("recordCheckin() records the report and surfaces the grade delta against the CHECKOUT baseline", () => {
    const ctx = createTenantContext(merchantA);
    conditionReports.create(ctx, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: "No visible damage.",
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    const result = service.recordCheckin(ctx, "OWNER", {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      conditionGrade: "FAIR",
      notes: "New scratch on the side panel.",
      createdBy: userA,
      createdAt: "2026-09-10T09:00:00.000Z",
    });

    expect(result.checkinReportId).toBeTruthy();
    expect(result.checkoutReport.conditionGrade).toBe("GOOD");
    expect(result.checkinReport.conditionGrade).toBe("FAIR");
    expect(result.delta).toMatchObject({
      checkoutGrade: "GOOD",
      checkinGrade: "FAIR",
      deltaSteps: -1,
      deteriorated: true,
      improved: false,
      unchanged: false,
    });
  });

  it("recordCheckin() rejects when the acting role lacks bookings:manage", () => {
    const ctx = createTenantContext(merchantA);
    conditionReports.create(ctx, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(() =>
      service.recordCheckin(ctx, "READ_ONLY", {
        orderLineId: orderLineA,
        inventoryUnitId: inventoryUnitA,
        conditionGrade: "FAIR",
        notes: null,
        createdBy: userA,
        createdAt: "2026-09-10T09:00:00.000Z",
      }),
    ).toThrow();
  });

  it("does not let merchant B record or read a CHECKIN against merchant A's order line", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    conditionReports.create(ctxA, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: null,
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });

    expect(() =>
      service.recordCheckin(ctxB, "OWNER", {
        orderLineId: orderLineA,
        inventoryUnitId: inventoryUnitA,
        conditionGrade: "FAIR",
        notes: null,
        createdBy: userA,
        createdAt: "2026-09-10T09:00:00.000Z",
      }),
    ).toThrow(MissingCheckoutBaselineError);
  });
});
