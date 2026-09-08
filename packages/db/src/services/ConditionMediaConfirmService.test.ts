import { createHash } from "node:crypto";
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
import { ConditionMediaRepository } from "../repositories/ConditionMediaRepository.js";
import {
  ConditionReportNotFoundError,
  MediaTooLargeError,
  UnsupportedMediaTypeError,
} from "./ConditionMediaUploadService.js";
import {
  ConditionMediaConfirmService,
  ConditionMediaHashMismatchError,
  ConditionMediaStorageKeyReusedError,
} from "./ConditionMediaConfirmService.js";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";

describe("ConditionMediaConfirmService", () => {
  let connection: Connection;
  let conditionReportRepo: ConditionReportRepository;
  let conditionMediaRepo: ConditionMediaRepository;
  let service: ConditionMediaConfirmService;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderLineA: string;
  let inventoryUnitA: string;
  let reportA: string;

  const bytes = Buffer.from("a photo of a slightly scuffed trailer hitch");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const orderRepo = new OrderRepository(connection);
    const locationRepo = new LocationRepository(connection);
    const unitRepo = new InventoryUnitRepository(connection);
    conditionReportRepo = new ConditionReportRepository(connection);
    conditionMediaRepo = new ConditionMediaRepository(connection);
    service = new ConditionMediaConfirmService(conditionReportRepo, conditionMediaRepo);

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

  const rolesThatCanConfirm: MerchantUserRole[] = ["OWNER", "ADMIN", "STAFF"];
  const rolesThatCannotConfirm: MerchantUserRole[] = ["READ_ONLY"];

  it.each(rolesThatCanConfirm)(
    "confirmUpload() allows role %s and records the server-computed sha256 — acceptance criterion",
    (role) => {
      const ctx = createTenantContext(merchantA);
      const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

      const id = service.confirmUpload(ctx, role, {
        conditionReportId: reportA,
        storageKey,
        contentType: "image/jpeg",
        bytes,
        declaredSha256: sha256,
        capturedAt: "2026-09-08T09:05:00.000Z",
      });

      const stored = conditionMediaRepo.findByStorageKey(ctx, storageKey);
      expect(stored?.id).toEqual(id);
      expect(stored?.sha256).toEqual(sha256);
      expect(stored?.bytes).toEqual(bytes.byteLength);
    },
  );

  it.each(rolesThatCannotConfirm)("confirmUpload() rejects role %s", (role) => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.confirmUpload(ctx, role, {
        conditionReportId: reportA,
        storageKey: `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`,
        contentType: "image/jpeg",
        bytes,
        declaredSha256: sha256,
        capturedAt: "2026-09-08T09:05:00.000Z",
      }),
    ).toThrow(ForbiddenActionError);
  });

  it("confirmUpload() detects a hash mismatch and does not write a row — acceptance criterion", () => {
    const ctx = createTenantContext(merchantA);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;
    const wrongDeclaredHash = createHash("sha256").update("a different photo entirely").digest("hex");

    expect(() =>
      service.confirmUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        storageKey,
        contentType: "image/jpeg",
        bytes,
        declaredSha256: wrongDeclaredHash,
        capturedAt: "2026-09-08T09:05:00.000Z",
      }),
    ).toThrow(ConditionMediaHashMismatchError);

    expect(conditionMediaRepo.findByStorageKey(ctx, storageKey)).toBeUndefined();
  });

  it("confirmUpload() rejects a second confirmation against the same storage key — acceptance criterion (overwrite rejected)", () => {
    const ctx = createTenantContext(merchantA);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    service.confirmUpload(ctx, "OWNER", {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes,
      declaredSha256: sha256,
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    const differentBytes = Buffer.from("a tampered replacement photo");
    const differentSha256 = createHash("sha256").update(differentBytes).digest("hex");

    expect(() =>
      service.confirmUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        storageKey,
        contentType: "image/jpeg",
        bytes: differentBytes,
        declaredSha256: differentSha256,
        capturedAt: "2026-09-08T09:10:00.000Z",
      }),
    ).toThrow(ConditionMediaStorageKeyReusedError);

    const stored = conditionMediaRepo.findByStorageKey(ctx, storageKey);
    expect(stored?.sha256).toEqual(sha256);
  });

  it("the database itself rejects a duplicate storage_key even bypassing the application-layer check", () => {
    const ctx = createTenantContext(merchantA);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    conditionMediaRepo.create(ctx, {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes: bytes.byteLength,
      sha256,
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(() =>
      conditionMediaRepo.create(ctx, {
        conditionReportId: reportA,
        storageKey,
        contentType: "image/jpeg",
        bytes: bytes.byteLength,
        sha256,
        capturedAt: "2026-09-08T09:10:00.000Z",
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("confirmUpload() rejects an unsupported content type", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.confirmUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        storageKey: `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`,
        contentType: "application/pdf",
        bytes,
        declaredSha256: sha256,
        capturedAt: "2026-09-08T09:05:00.000Z",
      }),
    ).toThrow(UnsupportedMediaTypeError);
  });

  it("confirmUpload() rejects an oversized upload", () => {
    const ctx = createTenantContext(merchantA);
    const oversized = Buffer.alloc(15_000_001);

    expect(() =>
      service.confirmUpload(ctx, "OWNER", {
        conditionReportId: reportA,
        storageKey: `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`,
        contentType: "image/jpeg",
        bytes: oversized,
        declaredSha256: createHash("sha256").update(oversized).digest("hex"),
        capturedAt: "2026-09-08T09:05:00.000Z",
      }),
    ).toThrow(MediaTooLargeError);
  });

  it("confirmUpload() throws ConditionReportNotFoundError for a report belonging to another merchant", () => {
    const ctxB = createTenantContext(merchantB);

    expect(() =>
      service.confirmUpload(ctxB, "OWNER", {
        conditionReportId: reportA,
        storageKey: `condition-media/${merchantB}/${reportA}/${generateUuidV7()}`,
        contentType: "image/jpeg",
        bytes,
        declaredSha256: sha256,
        capturedAt: "2026-09-08T09:05:00.000Z",
      }),
    ).toThrow(ConditionReportNotFoundError);
  });

  it("findByStorageKey() and listByConditionReport() are merchant-isolated", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const storageKey = `condition-media/${merchantA}/${reportA}/${generateUuidV7()}`;

    service.confirmUpload(ctxA, "OWNER", {
      conditionReportId: reportA,
      storageKey,
      contentType: "image/jpeg",
      bytes,
      declaredSha256: sha256,
      capturedAt: "2026-09-08T09:05:00.000Z",
    });

    expect(conditionMediaRepo.findByStorageKey(ctxB, storageKey)).toBeUndefined();
    expect(conditionMediaRepo.listByConditionReport(ctxB, reportA)).toEqual([]);
    expect(conditionMediaRepo.listByConditionReport(ctxA, reportA)).toHaveLength(1);
  });
});
