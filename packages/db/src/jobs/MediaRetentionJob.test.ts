import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ConditionMediaRepository } from "../repositories/ConditionMediaRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { runMediaRetentionSqlite, type MediaRetentionCandidate } from "./MediaRetentionJob.js";

const merchantId = generateUuidV7();

async function setup() {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const userId = generateUuidV7();
  await connection.db.insert(sqliteSchema.merchants).values({
    id: merchantId,
    name: "Acme Rentals",
    slug: "acme-rentals",
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await connection.db.insert(sqliteSchema.users).values({
    id: userId,
    email: "customer@example.com",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const ctx = createTenantContext(merchantId);
  const listingRepo = new ListingRepository(connection);
  const variantRepo = new VariantRepository(connection);
  const orderRepo = new OrderRepository(connection);
  const locationRepo = new LocationRepository(connection);
  const unitRepo = new InventoryUnitRepository(connection);
  const mediaRepo = new ConditionMediaRepository(connection);
  const auditLogRepo = new AuditLogRepository(connection);

  const listingId = listingRepo.create(ctx, {
    mode: "RENTAL",
    name: "Trailer",
    slug: "trailer",
    status: "PUBLISHED",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const variantId = variantRepo.create(ctx, {
    listingId,
    mode: "RENTAL",
    sku: "TRAILER-1",
    name: "Trailer - default",
    priceMinor: 5000,
    currency: "USD",
    ratePeriod: "DAY",
    depositMinor: 20000,
  });
  const locationId = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-1",
    trackingMode: "SERIALIZED",
  });

  /** One rental line, complete with a CHECKIN report and one media row on that report, plus optionally a damage claim. */
  async function createRentalWithMedia(opts: {
    checkinAt: string;
    storageKey: string;
    claim?: { state: string; filedAt: string; resolvedAt?: string };
  }) {
    const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
    const orderLineId = orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });

    const checkoutReportId = generateUuidV7();
    await connection.db.insert(sqliteSchema.conditionReports).values({
      id: checkoutReportId,
      merchantId,
      orderLineId,
      inventoryUnitId,
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      createdBy: userId,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.conditionReports).values({
      id: generateUuidV7(),
      merchantId,
      orderLineId,
      inventoryUnitId,
      phase: "CHECKIN",
      conditionGrade: "GOOD",
      createdBy: userId,
      createdAt: opts.checkinAt,
    });

    const mediaId = mediaRepo.create(ctx, {
      conditionReportId: checkoutReportId,
      storageKey: opts.storageKey,
      contentType: "image/jpeg",
      bytes: 1024,
      sha256: "a".repeat(64),
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    if (opts.claim) {
      await connection.db.insert(sqliteSchema.damageClaims).values({
        id: generateUuidV7(),
        merchantId,
        orderLineId,
        amountMinor: 5000,
        state: opts.claim.state as "DRAFT" | "FILED" | "CUSTOMER_NOTIFIED" | "RESOLVED_CAPTURED" | "RESOLVED_WAIVED" | "DISPUTED",
        filedAt: opts.claim.filedAt,
        resolvedAt: opts.claim.resolvedAt ?? null,
      });
    }

    return { orderLineId, mediaId };
  }

  return { connection, ctx, mediaRepo, auditLogRepo, createRentalWithMedia };
}

describe("runMediaRetentionSqlite (D085)", () => {
  it("dry run lists media eligible for deletion without deleting anything", async () => {
    const { connection, ctx, mediaRepo, createRentalWithMedia } = await setup();
    const { mediaId } = await createRentalWithMedia({
      checkinAt: "2026-01-01T00:00:00.000Z",
      storageKey: "media/eligible-1.jpg",
    });

    const result = await runMediaRetentionSqlite(connection, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ id: mediaId, reason: "NO_CLAIM_90_DAYS" });
    expect(result.deletedMediaIds).toEqual([]);
    expect(mediaRepo.findByStorageKey(ctx, "media/eligible-1.jpg")).toBeDefined();
  });

  it("does not list media whose rental completed less than 90 days ago with no claim", async () => {
    const { connection, createRentalWithMedia } = await setup();
    await createRentalWithMedia({ checkinAt: "2026-05-01T00:00:00.000Z", storageKey: "media/too-recent.jpg" });

    const result = await runMediaRetentionSqlite(connection, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not list media for a rental with a live (unresolved) damage claim, regardless of age", async () => {
    const { connection, createRentalWithMedia } = await setup();
    await createRentalWithMedia({
      checkinAt: "2020-01-01T00:00:00.000Z",
      storageKey: "media/live-claim.jpg",
      claim: { state: "FILED", filedAt: "2020-01-02T00:00:00.000Z" },
    });

    const result = await runMediaRetentionSqlite(connection, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not list media for a disputed claim even long after checkin", async () => {
    const { connection, createRentalWithMedia } = await setup();
    await createRentalWithMedia({
      checkinAt: "2015-01-01T00:00:00.000Z",
      storageKey: "media/disputed.jpg",
      claim: { state: "DISPUTED", filedAt: "2015-01-02T00:00:00.000Z" },
    });

    const result = await runMediaRetentionSqlite(connection, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.candidates).toEqual([]);
  });

  it("lists media for a resolved claim once 2 years have passed since resolution", async () => {
    const { connection, createRentalWithMedia } = await setup();
    const { mediaId } = await createRentalWithMedia({
      checkinAt: "2020-01-01T00:00:00.000Z",
      storageKey: "media/resolved.jpg",
      claim: { state: "RESOLVED_CAPTURED", filedAt: "2020-01-02T00:00:00.000Z", resolvedAt: "2024-01-01T00:00:00.000Z" },
    });

    const result = await runMediaRetentionSqlite(connection, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ id: mediaId, reason: "CLAIM_RESOLVED_2_YEARS" });
  });

  it("deletes eligible media and writes one audit record per deletion, in a real run", async () => {
    const { connection, ctx, mediaRepo, auditLogRepo, createRentalWithMedia } = await setup();
    const { mediaId } = await createRentalWithMedia({
      checkinAt: "2026-01-01T00:00:00.000Z",
      storageKey: "media/to-delete.jpg",
    });

    const deleted: MediaRetentionCandidate[] = [];
    const result = await runMediaRetentionSqlite(
      connection,
      { now: new Date("2026-06-01T00:00:00.000Z"), dryRun: false },
      (candidate) => {
        deleted.push(candidate);
      },
    );

    expect(result.dryRun).toBe(false);
    expect(result.deletedMediaIds).toEqual([mediaId]);
    expect(mediaRepo.findByStorageKey(ctx, "media/to-delete.jpg")).toBeUndefined();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ id: mediaId, storageKey: "media/to-delete.jpg" });

    const auditRows = auditLogRepo.list(ctx);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorType: "SYSTEM",
      action: "CONDITION_MEDIA_RETENTION_DELETED",
      entityType: "condition_media",
      entityId: mediaId,
    });
    expect(JSON.parse(auditRows[0]!.beforeJson ?? "{}")).toMatchObject({
      storageKey: "media/to-delete.jpg",
      reason: "NO_CLAIM_90_DAYS",
    });
  });

  it("is idempotent: a second real run finds nothing left to delete and writes no further audit records", async () => {
    const { connection, auditLogRepo, ctx, createRentalWithMedia } = await setup();
    await createRentalWithMedia({ checkinAt: "2026-01-01T00:00:00.000Z", storageKey: "media/idempotent.jpg" });

    const first = await runMediaRetentionSqlite(connection, { now: new Date("2026-06-01T00:00:00.000Z"), dryRun: false });
    expect(first.deletedMediaIds).toHaveLength(1);

    const second = await runMediaRetentionSqlite(connection, { now: new Date("2026-06-01T00:00:00.000Z"), dryRun: false });
    expect(second.deletedMediaIds).toEqual([]);

    expect(auditLogRepo.list(ctx)).toHaveLength(1);
  });

  it("a dry run followed by a real run deletes the same set the dry run reported", async () => {
    const { connection, createRentalWithMedia } = await setup();
    const { mediaId: eligibleId } = await createRentalWithMedia({
      checkinAt: "2026-01-01T00:00:00.000Z",
      storageKey: "media/dry-then-real.jpg",
    });
    await createRentalWithMedia({ checkinAt: "2026-05-20T00:00:00.000Z", storageKey: "media/still-fresh.jpg" });

    const dryRun = await runMediaRetentionSqlite(connection, { now: new Date("2026-06-01T00:00:00.000Z"), dryRun: true });
    expect(dryRun.candidates.map((c) => c.id)).toEqual([eligibleId]);

    const realRun = await runMediaRetentionSqlite(connection, { now: new Date("2026-06-01T00:00:00.000Z"), dryRun: false });
    expect(realRun.deletedMediaIds).toEqual([eligibleId]);
  });
});
