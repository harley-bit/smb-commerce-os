import {
  createTenantContext,
  defineCancellationPolicySet,
  ForbiddenActionError,
  generateUuidV7,
  type CancellationPolicySet,
} from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { PaymentRepository } from "../repositories/PaymentRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { SimulatedRefundProvider } from "../payments/SimulatedRefundProvider.js";
import { NoChargeToRefundError, RefundService } from "./RefundService.js";

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

describe("RefundService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let paymentRepo: PaymentRepository;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let provider: SimulatedRefundProvider;
  let service: RefundService;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orderRepo = new OrderRepository(connection);
    paymentRepo = new PaymentRepository(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    provider = new SimulatedRefundProvider();
    service = new RefundService(orderRepo, paymentRepo, provider, POLICY_SET);

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
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
  });

  function chargeOrder(ctx = createTenantContext(merchantA)) {
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

  function addLine(mode: "PRODUCT" | "SERVICE" | "RENTAL", startsAt: string | undefined, lineTotalMinor = 10_000) {
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
    });
  }

  it("applies the PRODUCT policy — full refund via the provider, gated by role", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);

    const ctx = createTenantContext(merchantA);
    const result = await service.refundOrderLine(ctx, "ADMIN", {
      orderLineId: lineId,
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "refund-1",
    });

    expect(result.refundAmountMinor).toBe(10_000);
    expect(result.refundPercent).toBe(100);
    const refundPayment = paymentRepo.findById(ctx, result.paymentId!);
    expect(refundPayment).toMatchObject({
      orderId: orderA,
      kind: "REFUND",
      amountMinor: 10_000,
      status: "SUCCEEDED",
    });
  });

  it("applies the SERVICE policy's tiered refund based on hours before start", async () => {
    chargeOrder();
    // 30 hours before start -> the 24h tier (50%), not the 48h tier.
    const lineId = addLine("SERVICE", "2026-09-10T06:00:00.000Z", 10_000);

    const ctx = createTenantContext(merchantA);
    const result = await service.refundOrderLine(ctx, "ADMIN", {
      orderLineId: lineId,
      cancelledAt: "2026-09-09T00:00:00.000Z",
      idempotencyKey: "refund-2",
    });

    expect(result.refundPercent).toBe(50);
    expect(result.refundAmountMinor).toBe(5_000);
  });

  it("applies the RENTAL policy — a different tier structure from SERVICE for the same hours-before-start", async () => {
    chargeOrder();
    // 30 hours before start again, but under the rental policy's own tiers this time.
    const lineId = addLine("RENTAL", "2026-09-10T06:00:00.000Z", 10_000);

    const ctx = createTenantContext(merchantA);
    const result = await service.refundOrderLine(ctx, "ADMIN", {
      orderLineId: lineId,
      cancelledAt: "2026-09-09T00:00:00.000Z",
      idempotencyKey: "refund-3",
    });

    expect(result.refundPercent).toBe(25);
    expect(result.refundAmountMinor).toBe(2_500);
  });

  it("throws if there is no original charge to refund against", async () => {
    const lineId = addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    await expect(
      service.refundOrderLine(ctx, "ADMIN", {
        orderLineId: lineId,
        cancelledAt: "2026-09-08T01:00:00.000Z",
        idempotencyKey: "refund-4",
      }),
    ).rejects.toThrow(NoChargeToRefundError);
  });

  it("security check: STAFF cannot refund — only ADMIN and OWNER may", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    await expect(
      service.refundOrderLine(ctx, "STAFF", {
        orderLineId: lineId,
        cancelledAt: "2026-09-08T01:00:00.000Z",
        idempotencyKey: "refund-5",
      }),
    ).rejects.toThrow(ForbiddenActionError);

    await expect(
      service.refundOrderLine(ctx, "READ_ONLY", {
        orderLineId: lineId,
        cancelledAt: "2026-09-08T01:00:00.000Z",
        idempotencyKey: "refund-6",
      }),
    ).rejects.toThrow(ForbiddenActionError);

    // No refund payment was written by either rejected attempt.
    expect(paymentRepo.listByOrderId(ctx, orderA).filter((p) => p.kind === "REFUND")).toHaveLength(0);
  });

  it("OWNER may also refund", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    await expect(
      service.refundOrderLine(ctx, "OWNER", {
        orderLineId: lineId,
        cancelledAt: "2026-09-08T01:00:00.000Z",
        idempotencyKey: "refund-7",
      }),
    ).resolves.toBeDefined();
  });

  it("does not let merchant B refund merchant A's order line", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);
    const ctxB = createTenantContext(merchantB);

    await expect(
      service.refundOrderLine(ctxB, "ADMIN", {
        orderLineId: lineId,
        cancelledAt: "2026-09-08T01:00:00.000Z",
        idempotencyKey: "refund-8",
      }),
    ).rejects.toThrow();

    const ctxA = createTenantContext(merchantA);
    expect(paymentRepo.listByOrderId(ctxA, orderA).filter((p) => p.kind === "REFUND")).toHaveLength(0);
  });

  it("replaying the same idempotency key does not mint a second refund payment", async () => {
    chargeOrder();
    const lineId = addLine("PRODUCT", undefined);
    const ctx = createTenantContext(merchantA);

    const first = await service.refundOrderLine(ctx, "ADMIN", {
      orderLineId: lineId,
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "refund-9",
    });
    const replay = await service.refundOrderLine(ctx, "ADMIN", {
      orderLineId: lineId,
      cancelledAt: "2026-09-08T01:00:00.000Z",
      idempotencyKey: "refund-9",
    });

    expect(replay.paymentId).toBe(first.paymentId);
    expect(paymentRepo.listByOrderId(ctx, orderA).filter((p) => p.kind === "REFUND")).toHaveLength(1);
  });
});
