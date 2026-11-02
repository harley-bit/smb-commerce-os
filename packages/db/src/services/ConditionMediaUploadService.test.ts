import { createTenantContext, ForbiddenActionError, generateUuidV7 } from "@smb-os/domain";
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
import { HmacMediaUploadProvider } from "../media/HmacMediaUploadProvider.js";
import {
  ConditionMediaUploadService,
  ConditionReportNotFoundError,
  MediaTooLargeError,
  UnsupportedMediaTypeError,
} from "./ConditionMediaUploadService.js";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";

describe("ConditionMediaUploadService", () => {
  let connection: Connection;
  let conditionReportRepo: ConditionReportRepository;
  let service: ConditionMediaUploadService;
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
    const uploadProvider = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "test-secret",
    });
    service = new ConditionMediaUploadService(conditionReportRepo, uploadProvider);

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

  const rolesThatCanUpload: MerchantUserRole[] = ["OWNER", "ADMIN", "STAFF"];
  const rolesThatCannotUpload: MerchantUserRole[] = ["READ_ONLY"];

  it.each(rolesThatCanUpload)(
    "requestUpload() allows role %s and returns a signed upload URL with a randomized storage key",
    async (role) => {
      const ctx = createTenantContext(merchantA);

      const result = await service.requestUpload(ctx, role, {
        conditionReportId: reportA,
        contentType: "image/jpeg",
        bytes: 500_000,
      });

      expect(result.uploadUrl).toContain("signature=");
      expect(result.storageKey).toContain(merchantA);
      expect(result.storageKey).toContain(reportA);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    },
  );

  it("requestUpload() generates a different storage key on every call", async () => {
    const ctx = createTenantContext(merchantA);

    const first = await service.requestUpload(ctx, "OWNER", {
      conditionReportId: reportA,
      contentType: "image/jpeg",
      bytes: 500_000,
    });
    const second = await service.requestUpload(ctx, "OWNER", {
      conditionReportId: reportA,
      contentType: "image/jpeg",
      bytes: 500_000,
    });

    expect(first.storageKey).not.toEqual(second.storageKey);
  });

  it.each(rolesThatCannotUpload)("requestUpload() rejects role %s", async (role) => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.requestUpload(ctx, role, {
        conditionReportId: reportA,
        contentType: "image/jpeg",
        bytes: 500_000,
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("requestUpload() rejects an unsupported content type — acceptance criterion", async () => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.requestUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        contentType: "application/pdf",
        bytes: 500_000,
      }),
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("requestUpload() rejects an oversized upload — acceptance criterion", async () => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.requestUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        contentType: "image/jpeg",
        bytes: 50_000_000,
      }),
    ).rejects.toThrow(MediaTooLargeError);
  });

  it("requestUpload() rejects a non-positive byte count", async () => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.requestUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        contentType: "image/jpeg",
        bytes: 0,
      }),
    ).rejects.toThrow(MediaTooLargeError);
  });

  it("requestUpload() throws ConditionReportNotFoundError for a report belonging to another merchant", async () => {
    const ctxB = createTenantContext(merchantB);

    await expect(
      service.requestUpload(ctxB, "OWNER", {
        conditionReportId: reportA,
        contentType: "image/jpeg",
        bytes: 500_000,
      }),
    ).rejects.toThrow(ConditionReportNotFoundError);
  });

  it("requestUpload() throws ConditionReportNotFoundError for a non-existent report", async () => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.requestUpload(ctx, "OWNER", {
        conditionReportId: "does-not-exist",
        contentType: "image/jpeg",
        bytes: 500_000,
      }),
    ).rejects.toThrow(ConditionReportNotFoundError);
  });
});
