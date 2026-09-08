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
import { ConditionMediaRepository } from "./ConditionMediaRepository.js";

describe("ConditionMediaRepository", () => {
  let connection: Connection;
  let conditionReportRepo: ConditionReportRepository;
  let repo: ConditionMediaRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderLineA: string;
  let inventoryUnitA: string;
  let reportA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const orderRepo = new OrderRepository(connection);
    const locationRepo = new LocationRepository(connection);
    const unitRepo = new InventoryUnitRepository(connection);
    conditionReportRepo = new ConditionReportRepository(connection);
    repo = new ConditionMediaRepository(connection);

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
    reportA = conditionReportRepo.create(ctxA, {
      orderLineId: orderLineA,
      inventoryUnitId: inventoryUnitA,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      createdBy: userA,
      createdAt: "2026-09-08T09:00:00.000Z",
    });
  });

  it("create() writes a row scoped to the acting merchant and does not let merchant B read it", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    const id = repo.create(ctxA, {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes: 1234,
      sha256: "a".repeat(64),
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(id).toBeTruthy();
    expect(repo.findByStorageKey(ctxB, storageKey)).toBeUndefined();
  });

  it("findByStorageKey() does not let merchant B read merchant A's condition media", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    repo.create(ctxA, {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes: 1234,
      sha256: "a".repeat(64),
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(repo.findByStorageKey(ctxA, storageKey)).toMatchObject({ storageKey });
    expect(repo.findByStorageKey(ctxB, storageKey)).toBeUndefined();
  });

  it("listByConditionReport() does not let merchant B list merchant A's condition media", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      conditionReportId: reportA,
      storageKey: `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`,
      contentType: "image/jpeg",
      bytes: 1234,
      sha256: "a".repeat(64),
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(repo.listByConditionReport(ctxA, reportA)).toHaveLength(1);
    expect(repo.listByConditionReport(ctxB, reportA)).toEqual([]);
  });

  it("rejects a second row for a storage key already recorded — acceptance criterion (overwrite rejected)", () => {
    const ctxA = createTenantContext(merchantA);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    repo.create(ctxA, {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes: 1234,
      sha256: "a".repeat(64),
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(() =>
      repo.create(ctxA, {
        conditionReportId: reportA,
        storageKey,
        contentType: "image/jpeg",
        bytes: 5678,
        sha256: "b".repeat(64),
        capturedAt: "2026-09-08T09:10:00.000Z",
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
