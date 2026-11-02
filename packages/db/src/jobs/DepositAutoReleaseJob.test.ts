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
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { releaseCompletedDepositsSqlite, type DepositReleaseCandidate } from "./DepositAutoReleaseJob.js";

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
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  await connection.db.insert(sqliteSchema.users).values({
    id: userId,
    email: "customer@example.com",
    status: "ACTIVE",
    createdAt: "2026-09-08T00:00:00.000Z",
  });

  const ctx = createTenantContext(merchantId);
  const listingRepo = new ListingRepository(connection);
  const variantRepo = new VariantRepository(connection);
  const orderRepo = new OrderRepository(connection);
  const locationRepo = new LocationRepository(connection);
  const unitRepo = new InventoryUnitRepository(connection);
  const deposits = new DepositAuthorizationRepository(connection);

  const listingId = listingRepo.create(ctx, {
    mode: "RENTAL",
    name: "Trailer",
    slug: "trailer",
    status: "PUBLISHED",
    createdAt: "2026-09-08T00:00:00.000Z",
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
  const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
  const orderLineId = orderRepo.addLine(ctx, orderId, {
    listingId,
    variantId,
    mode: "RENTAL",
    quantity: 1,
    unitPriceMinor: 5000,
    lineTotalMinor: 5000,
  });

  const locationId = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-1",
    trackingMode: "SERIALIZED",
  });

  const paymentId = generateUuidV7();
  await connection.db.insert(sqliteSchema.payments).values({
    id: paymentId,
    merchantId,
    orderId,
    provider: "stripe",
    providerRef: "pi_test_123",
    kind: "DEPOSIT_HOLD",
    amountMinor: 20000,
    currency: "USD",
    status: "SUCCEEDED",
    createdAt: "2026-09-08T00:00:00.000Z",
  });

  const depositId = deposits.create(ctx, {
    orderLineId,
    paymentId,
    amountMinor: 20000,
    currency: "USD",
    authorizedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
  });

  async function recordCheckin() {
    await connection.db.insert(sqliteSchema.conditionReports).values({
      id: generateUuidV7(),
      merchantId,
      orderLineId,
      inventoryUnitId,
      phase: "CHECKIN",
      conditionGrade: "GOOD",
      createdBy: userId,
      createdAt: "2026-09-15T00:00:00.000Z",
    });
  }

  async function fileDamageClaim() {
    await connection.db.insert(sqliteSchema.damageClaims).values({
      id: generateUuidV7(),
      merchantId,
      orderLineId,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-15T00:00:00.000Z",
    });
  }

  return { connection, deposits, ctx, depositId, orderLineId, recordCheckin, fileDamageClaim };
}

describe("releaseCompletedDepositsSqlite (D080)", () => {
  it("does not release a deposit whose rental has not checked in yet", async () => {
    const { connection, deposits, ctx, depositId } = await setup();

    const result = releaseCompletedDepositsSqlite(connection);

    expect(result.releasedDepositAuthorizationIds).toEqual([]);
    expect(deposits.findById(ctx, depositId)).toMatchObject({ state: "AUTHORIZED" });
  });

  it("releases a deposit whose rental checked in with no claim filed, and notifies the customer", async () => {
    const { connection, deposits, ctx, depositId, orderLineId, recordCheckin } = await setup();
    await recordCheckin();

    const notified: DepositReleaseCandidate[] = [];
    const result = releaseCompletedDepositsSqlite(connection, (candidate) => notified.push(candidate));

    expect(result.releasedDepositAuthorizationIds).toEqual([depositId]);
    expect(deposits.findById(ctx, depositId)).toMatchObject({ state: "RELEASED" });
    expect(deposits.findById(ctx, depositId)?.releasedAt).not.toBeNull();

    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ id: depositId, orderLineId, amountMinor: 20000 });
  });

  it("does not release a deposit whose order line has a damage claim on file", async () => {
    const { connection, deposits, ctx, depositId, recordCheckin, fileDamageClaim } = await setup();
    await recordCheckin();
    await fileDamageClaim();

    const result = releaseCompletedDepositsSqlite(connection);

    expect(result.releasedDepositAuthorizationIds).toEqual([]);
    expect(deposits.findById(ctx, depositId)).toMatchObject({ state: "AUTHORIZED" });
  });

  it("is idempotent: a second run after release is a no-op and does not re-notify", async () => {
    const { connection, depositId, recordCheckin } = await setup();
    await recordCheckin();

    const first = releaseCompletedDepositsSqlite(connection);
    expect(first.releasedDepositAuthorizationIds).toEqual([depositId]);

    const notified: DepositReleaseCandidate[] = [];
    const second = releaseCompletedDepositsSqlite(connection, (candidate) => notified.push(candidate));
    expect(second.releasedDepositAuthorizationIds).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("does not release a deposit that is not in AUTHORIZED state, even with a completed rental and no claim", async () => {
    const { connection, deposits, ctx, depositId, recordCheckin } = await setup();
    deposits.capture(ctx, depositId, 20000);
    await recordCheckin();

    const result = releaseCompletedDepositsSqlite(connection);

    expect(result.releasedDepositAuthorizationIds).toEqual([]);
    expect(deposits.findById(ctx, depositId)).toMatchObject({ state: "CAPTURED" });
  });
});
