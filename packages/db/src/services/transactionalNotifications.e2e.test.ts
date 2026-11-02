import {
  buildDepositReleasedNotification,
  buildOrderConfirmationNotification,
  buildReservationReminderNotification,
  buildReturnDueNotification,
  createTenantContext,
  generateUuidV7,
  type TransactionalNotification,
} from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { OrderConfirmationService } from "./OrderConfirmationService.js";
import { detectUpcomingReservationsSqlite } from "../jobs/ReservationReminderJob.js";
import { detectReturnsDueSqlite } from "../jobs/ReturnDueJob.js";
import { releaseCompletedDepositsSqlite } from "../jobs/DepositAutoReleaseJob.js";

/**
 * `docs/cards/D134.md` acceptance criterion — "all four delivered in test":
 * proves each of the four transactional notification types (confirmation,
 * reminder, return-due, deposit release) actually fires, end to end through
 * the real repository/service/job that produces it, carrying content built
 * by `@smb-os/domain`'s pure `transactionalNotifications.ts` builders — not
 * just that each builder produces correct text in isolation (already proven
 * in `packages/domain`), but that each real trigger point in this codebase
 * is wired to fire it.
 */
async function setupMerchant() {
  const merchantId = generateUuidV7();
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
  const reservationRepo = new ReservationRepository(connection);
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
  const locationId = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
  const inventoryUnitId = unitRepo.create(ctx, {
    variantId,
    locationId,
    unitCode: "UNIT-1",
    trackingMode: "SERIALIZED",
  });

  return { connection, ctx, userId, listingId, variantId, inventoryUnitId, orderRepo, reservationRepo, deposits };
}

describe("Transactional notifications, all four (D134)", () => {
  it("1. fires an order confirmation notification with the receipt total", async () => {
    const { ctx, userId, orderRepo, listingId, variantId } = await setupMerchant();
    const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
    orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1000,
      lineTotalMinor: 2000,
    });
    orderRepo.updateContactDetails(ctx, orderId, { contactName: "Test Customer", contactEmail: "customer@example.com" });
    orderRepo.updateTotals(ctx, orderId, { subtotalMinor: 2000, taxMinor: 0, totalMinor: 2000 });

    const fired: TransactionalNotification[] = [];
    const service = new OrderConfirmationService(orderRepo, (input) => {
      fired.push(
        buildOrderConfirmationNotification({
          orderId: input.orderId,
          totalMinor: input.receipt.totalMinor,
          currency: input.receipt.currency,
        }),
      );
    });

    service.confirmOrder(ctx, { orderId, confirmedAt: "2026-09-09T00:00:00.000Z" });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ type: "ORDER_CONFIRMATION" });
    expect(fired[0]!.body).toContain("20.00 USD");
  });

  it("2. fires a reservation reminder notification ahead of a CONFIRMED reservation's start", async () => {
    const { connection, ctx, userId, orderRepo, reservationRepo, listingId, variantId, inventoryUnitId } =
      await setupMerchant();
    const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
    const orderLineId = orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "SERVICE",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
    reservationRepo.create(ctx, {
      orderLineId,
      subjectType: "INVENTORY_UNIT",
      subjectId: inventoryUnitId,
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-10T01:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    const fired: TransactionalNotification[] = [];
    detectUpcomingReservationsSqlite(connection, "2026-09-09T12:00:00.000Z", 24, {
      onCustomerNotify: (upcoming) =>
        fired.push(
          buildReservationReminderNotification({ subjectLabel: "your booking", startsAt: upcoming.startsAt }),
        ),
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ type: "RESERVATION_REMINDER" });
    expect(fired[0]!.body).toContain("2026-09-10T00:00:00.000Z");
  });

  it("3. fires a return-due notification ahead of an IN_USE rental's ends_at", async () => {
    const { connection, ctx, userId, orderRepo, reservationRepo, listingId, variantId, inventoryUnitId } =
      await setupMerchant();
    const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
    const orderLineId = orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
    reservationRepo.create(ctx, {
      orderLineId,
      subjectType: "INVENTORY_UNIT",
      subjectId: inventoryUnitId,
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-09-10T00:00:00.000Z",
      quantity: 1,
      state: "IN_USE",
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    const fired: TransactionalNotification[] = [];
    detectReturnsDueSqlite(connection, "2026-09-09T12:00:00.000Z", 24, {
      onCustomerNotify: (dueSoon) =>
        fired.push(buildReturnDueNotification({ subjectLabel: "your rental", endsAt: dueSoon.endsAt })),
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ type: "RETURN_DUE" });
    expect(fired[0]!.body).toContain("2026-09-10T00:00:00.000Z");
  });

  it("4. fires a deposit release notification once a completed rental's hold is auto-released", async () => {
    const { connection, ctx, userId, orderRepo, deposits, listingId, variantId, inventoryUnitId } =
      await setupMerchant();
    const orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CONFIRMED", currency: "USD" });
    const orderLineId = orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });

    const paymentId = generateUuidV7();
    await connection.db.insert(sqliteSchema.payments).values({
      id: paymentId,
      merchantId: ctx.merchantId,
      orderId,
      provider: "stripe",
      providerRef: "pi_test_134",
      kind: "DEPOSIT_HOLD",
      amountMinor: 20000,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    deposits.create(ctx, {
      orderLineId,
      paymentId,
      amountMinor: 20000,
      currency: "USD",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.conditionReports).values({
      id: generateUuidV7(),
      merchantId: ctx.merchantId,
      orderLineId,
      inventoryUnitId,
      phase: "CHECKIN",
      conditionGrade: "GOOD",
      createdBy: userId,
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    const fired: TransactionalNotification[] = [];
    releaseCompletedDepositsSqlite(connection, (candidate) =>
      fired.push(buildDepositReleasedNotification({ amountMinor: candidate.amountMinor, currency: candidate.currency })),
    );

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ type: "DEPOSIT_RELEASED" });
    expect(fired[0]!.body).toContain("200.00 USD");
  });
});
