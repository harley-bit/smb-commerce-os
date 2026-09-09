import { createTenantContext, defineCancellationPolicySet, generateUuidV7, type CancellationPolicySet } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { PaymentRepository } from "../repositories/PaymentRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { SimulatedRefundProvider } from "../payments/SimulatedRefundProvider.js";
import { SimulatedDepositHoldProvider } from "../payments/SimulatedDepositHoldProvider.js";
import { DepositAuthorizationService } from "./DepositAuthorizationService.js";
import { CustomerCancellationService, OrderAlreadyFinalizedError } from "./CustomerCancellationService.js";

const POLICY_SET: CancellationPolicySet = defineCancellationPolicySet({
  product: { mode: "PRODUCT", tiers: [{ minHoursBeforeStart: 0, refundPercent: 100 }] },
  service: {
    mode: "SERVICE",
    tiers: [
      { minHoursBeforeStart: 48, refundPercent: 100 },
      { minHoursBeforeStart: 24, refundPercent: 50 },
      { minHoursBeforeStart: 0, refundPercent: 0 },
    ],
  },
  rental: {
    mode: "RENTAL",
    tiers: [
      { minHoursBeforeStart: 72, refundPercent: 90 },
      { minHoursBeforeStart: 0, refundPercent: 25 },
    ],
  },
});

describe("CustomerCancellationService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let paymentRepo: PaymentRepository;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let reservationRepo: ReservationRepository;
  let depositRepo: DepositAuthorizationRepository;
  let depositService: DepositAuthorizationService;
  let refundProvider: SimulatedRefundProvider;
  let depositHoldProvider: SimulatedDepositHoldProvider;
  let service: CustomerCancellationService;
  let merchantA: string;
  let userA: string;
  let userB: string;
  let orderA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orderRepo = new OrderRepository(connection);
    paymentRepo = new PaymentRepository(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    reservationRepo = new ReservationRepository(connection);
    depositRepo = new DepositAuthorizationRepository(connection);
    refundProvider = new SimulatedRefundProvider();
    depositHoldProvider = new SimulatedDepositHoldProvider();
    depositService = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, depositHoldProvider);
    service = new CustomerCancellationService(
      orderRepo,
      paymentRepo,
      reservationRepo,
      depositRepo,
      depositService,
      refundProvider,
      POLICY_SET,
    );

    merchantA = generateUuidV7();
    userA = generateUuidV7();
    userB = generateUuidV7();

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
    await connection.db.insert(sqliteSchema.users).values({
      id: userB,
      email: "b@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const ctxA = createTenantContext(merchantA);
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
  });

  function chargeOrder() {
    const ctx = createTenantContext(merchantA);
    return paymentRepo.create(ctx, {
      orderId: orderA,
      provider: "stripe",
      providerRef: "pi_original_charge",
      kind: "CHARGE",
      amountMinor: 10_000,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  }

  function addLine(
    mode: "PRODUCT" | "SERVICE" | "RENTAL",
    startsAt: string | undefined,
    lineTotalMinor = 10_000,
    depositMinor?: number,
  ) {
    const ctx = createTenantContext(merchantA);
    const listingId = listingRepo.create(ctx, {
      mode,
      name: `${mode} listing`,
      slug: `${mode.toLowerCase()}-listing-${generateUuidV7()}`,
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantId = variantRepo.create(ctx, {
      listingId,
      mode,
      sku: `${mode}-SKU-${generateUuidV7()}`,
      name: `${mode} variant`,
      priceMinor: lineTotalMinor,
      currency: "USD",
      ...(mode === "RENTAL" ? { ratePeriod: "DAY" as const } : {}),
    });
    return orderRepo.addLine(ctx, orderA, {
      listingId,
      variantId,
      mode,
      quantity: 1,
      unitPriceMinor: lineTotalMinor,
      lineTotalMinor,
      startsAt,
      ...(depositMinor !== undefined ? { depositMinor } : {}),
    });
  }

  it("applies the PRODUCT policy — full refund via the provider", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);

    const ctx = createTenantContext(merchantA);
    const result = await service.cancelOrder(ctx, userA, orderA, {
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "cancel-1",
    });

    expect(result).toBeDefined();
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0]).toMatchObject({ orderLineId: lineId, refundPercent: 100, refundAmountMinor: 10_000 });
    const refundPayment = paymentRepo.findById(ctx, result!.lines[0]!.paymentId!);
    expect(refundPayment).toMatchObject({ kind: "REFUND", amountMinor: 10_000, status: "SUCCEEDED" });
    expect(orderRepo.findById(ctx, orderA)).toMatchObject({ status: "CANCELLED", cancelledAt: "2026-09-08T01:00:00.000Z" });
  });

  it("applies the SERVICE policy's tiered refund and cancels the line's blocking reservation", async () => {
    chargeOrder();
    // 30 hours before start -> the 24h tier (50%), not the 48h tier.
    const lineId = addLine("SERVICE", "2026-09-10T06:00:00.000Z", 10_000);
    const ctx = createTenantContext(merchantA);
    const reservationId = reservationRepo.create(ctx, {
      orderLineId: lineId,
      subjectType: "RESOURCE",
      subjectId: generateUuidV7(),
      startsAt: "2026-09-10T06:00:00.000Z",
      endsAt: "2026-09-10T07:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const result = await service.cancelOrder(ctx, userA, orderA, {
      cancelledAt: "2026-09-09T00:00:00.000Z",
      idempotencyKey: "cancel-2",
    });

    expect(result!.lines[0]).toMatchObject({ refundPercent: 50, refundAmountMinor: 5_000 });
    expect(reservationRepo.findById(ctx, reservationId)).toMatchObject({ state: "CANCELLED" });
  });

  it("applies the RENTAL policy and releases the line's deposit hold", async () => {
    chargeOrder();
    const lineId = addLine("RENTAL", "2026-09-11T06:00:00.000Z", 10_000, 5_000);
    const ctx = createTenantContext(merchantA);
    const hold = await depositService.placeHold(ctx, {
      orderLineId: lineId,
      connectedAccountId: "acct_test",
      idempotencyKey: "hold-1",
      authorizedAt: "2026-09-08T00:00:00.000Z",
    });

    // 30 hours before start -> the rental policy's lower (non-72h) tier.
    const result = await service.cancelOrder(ctx, userA, orderA, {
      cancelledAt: "2026-09-10T00:00:00.000Z",
      idempotencyKey: "cancel-3",
    });

    expect(result!.lines[0]).toMatchObject({ refundPercent: 25, refundAmountMinor: 2_500, depositReleased: true });
    expect(depositRepo.findById(ctx, hold.depositAuthorizationId)).toMatchObject({ state: "RELEASED" });
  });

  it("security check: a different customer cannot cancel this order — same 404-shaped outcome as a nonexistent order", async () => {
    chargeOrder();
    addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    const result = await service.cancelOrder(ctx, userB, orderA, {
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "cancel-4",
    });

    expect(result).toBeUndefined();
    expect(orderRepo.findById(ctx, orderA)).toMatchObject({ status: "CONFIRMED" });
    expect(paymentRepo.listByOrderId(ctx, orderA).filter((p) => p.kind === "REFUND")).toHaveLength(0);
  });

  it("returns undefined for a nonexistent order id, indistinguishable from the ownership-mismatch case", async () => {
    const ctx = createTenantContext(merchantA);
    const result = await service.cancelOrder(ctx, userA, generateUuidV7(), {
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "cancel-5",
    });
    expect(result).toBeUndefined();
  });

  it("refuses to cancel an order that is already cancelled", async () => {
    chargeOrder();
    addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    await service.cancelOrder(ctx, userA, orderA, {
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "cancel-6",
    });

    await expect(
      service.cancelOrder(ctx, userA, orderA, {
        cancelledAt: "2026-09-08T02:00:00.000Z",
        idempotencyKey: "cancel-7",
      }),
    ).rejects.toThrow(OrderAlreadyFinalizedError);
  });
});
