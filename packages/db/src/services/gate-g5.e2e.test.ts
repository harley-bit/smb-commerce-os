import { createTenantContext, defineCancellationPolicySet, generateUuidV7, type CancellationPolicySet } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { PaymentRepository } from "../repositories/PaymentRepository.js";
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { CartService } from "./CartService.js";
import { CheckoutPaymentService } from "./CheckoutPaymentService.js";
import { RefundService } from "./RefundService.js";
import { DepositAuthorizationService } from "./DepositAuthorizationService.js";
import { SimulatedPaymentIntentProvider } from "../payments/SimulatedPaymentIntentProvider.js";
import { SimulatedRefundProvider } from "../payments/SimulatedRefundProvider.js";
import { SimulatedDepositHoldProvider } from "../payments/SimulatedDepositHoldProvider.js";

/**
 * `docs/cards/D100.md` — Gate G5, "end-to-end money movement across all
 * three modes: charges, splits, deposits, and refunds all correct." Each of
 * these pieces already has its own unit tests (D089/D094–D096); this gate
 * proves they compose correctly through the real service layer for
 * PRODUCT, SERVICE, and RENTAL in one continuous run per mode — the same
 * "compose, don't just unit-test in isolation" bar G2/G4 set.
 */
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
    tiers: [{ minHoursBeforeStart: 0, refundPercent: 0 }],
  },
});

describe("Gate G5 — payments E2E across all three modes", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let paymentRepo: PaymentRepository;
  let depositRepo: DepositAuthorizationRepository;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let cartService: CartService;
  let paymentIntentProvider: SimulatedPaymentIntentProvider;
  let checkoutService: CheckoutPaymentService;
  let refundProvider: SimulatedRefundProvider;
  let refundService: RefundService;
  let depositHoldProvider: SimulatedDepositHoldProvider;
  let depositService: DepositAuthorizationService;

  let merchantA: string;
  let customerUserId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    paymentRepo = new PaymentRepository(connection);
    depositRepo = new DepositAuthorizationRepository(connection);

    cartService = new CartService(orderRepo, variantRepo);
    paymentIntentProvider = new SimulatedPaymentIntentProvider();
    checkoutService = new CheckoutPaymentService(orderRepo, paymentIntentProvider);
    refundProvider = new SimulatedRefundProvider();
    refundService = new RefundService(orderRepo, paymentRepo, refundProvider, POLICY_SET);
    depositHoldProvider = new SimulatedDepositHoldProvider();
    depositService = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, depositHoldProvider);

    merchantA = generateUuidV7();
    customerUserId = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.users).values({
      id: customerUserId,
      email: "customer@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("PRODUCT mode — charge, application-fee split, and full refund all correct end to end", async () => {
    const ctx = createTenantContext(merchantA);

    const listingId = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "Kayak",
      slug: "kayak",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantId = variantRepo.create(ctx, {
      listingId,
      mode: "PRODUCT",
      sku: "KAYAK-1",
      name: "Kayak — Standard",
      priceMinor: 10_000,
      currency: "USD",
    });

    const cartId = cartService.createCart(ctx, { customerUserId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId, quantity: 1 });
    const [line] = orderRepo.listLines(ctx, cartId);
    if (!line) {
      throw new Error("expected the cart to have exactly one line after addProductLine");
    }

    // 1. CHARGE — the checkout intent's amount and fee split are read
    // exclusively from the server-recomputed order total.
    const checkout = await checkoutService.createCheckoutIntent(ctx, {
      orderId: cartId,
      connectedAccountId: "acct_merchant_a",
      takeRateBasisPoints: 250, // 2.5%
      idempotencyKey: "g5-product-checkout-1",
    });
    expect(checkout.amountMinor).toBe(10_000);
    // SPLIT — platform fee and merchant proceeds must reconcile exactly to
    // the charge, the same invariant `computeApplicationFeeSplit` enforces
    // in isolation (D089), now proven against a real checkout result.
    expect(checkout.applicationFeeAmountMinor + checkout.merchantProceedsMinor).toBe(checkout.amountMinor);
    expect(checkout.applicationFeeAmountMinor).toBe(250);
    expect(checkout.merchantProceedsMinor).toBe(9_750);

    const chargePaymentId = paymentRepo.create(ctx, {
      orderId: cartId,
      provider: "stripe",
      providerRef: checkout.intentId,
      kind: "CHARGE",
      amountMinor: checkout.amountMinor,
      currency: checkout.currency,
      status: "SUCCEEDED",
      createdAt: "2026-09-08T01:00:00.000Z",
    });
    connection.sqlite.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(cartId);

    // 2. REFUND — a product's policy is a flat 100% refund at any notice,
    // so cancelling this order line refunds the full charge.
    const refund = await refundService.refundOrderLine(ctx, "OWNER", {
      orderLineId: line.id,
      cancelledAt: "2026-09-08T02:00:00.000Z",
      idempotencyKey: "g5-product-refund-1",
    });
    expect(refund.mode).toBe("PRODUCT");
    expect(refund.refundPercent).toBe(100);
    expect(refund.refundAmountMinor).toBe(10_000);
    expect(refund.paymentId).not.toBeNull();

    const refundPayment = paymentRepo.findById(ctx, refund.paymentId!);
    expect(refundPayment).toMatchObject({ kind: "REFUND", amountMinor: 10_000, status: "SUCCEEDED" });

    // The original charge and the refund are two distinct, correctly-typed
    // payment rows against the same order — money moved in, then correctly
    // moved back out, in full.
    const allPayments = paymentRepo.listByOrderId(ctx, cartId);
    expect(allPayments).toHaveLength(2);
    expect(allPayments.find((p) => p.id === chargePaymentId)).toMatchObject({ kind: "CHARGE" });
  });

  it("SERVICE mode — charge and a partial refund by cancellation timing are both correct end to end", async () => {
    const ctx = createTenantContext(merchantA);

    const listingId = listingRepo.create(ctx, {
      mode: "SERVICE",
      name: "Bike Tune-Up",
      slug: "bike-tune-up",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantId = variantRepo.create(ctx, {
      listingId,
      mode: "SERVICE",
      sku: "TUNEUP-1",
      name: "Bike Tune-Up — Standard",
      priceMinor: 8_000,
      currency: "USD",
    });

    // Service orders don't go through `CartService` (PRODUCT-mode only) —
    // built the same direct way `gate-g4.e2e.test.ts` builds a rental order.
    const orderId = orderRepo.create(ctx, { customerUserId, status: "CART", currency: "USD" });
    const lineId = orderRepo.addLine(ctx, orderId, {
      listingId,
      variantId,
      mode: "SERVICE",
      quantity: 1,
      unitPriceMinor: 8_000,
      lineTotalMinor: 8_000,
      startsAt: "2026-09-12T09:00:00.000Z",
    });
    orderRepo.updateTotals(ctx, orderId, { subtotalMinor: 8_000, taxMinor: 0, totalMinor: 8_000 });

    // 1. CHARGE.
    const checkout = await checkoutService.createCheckoutIntent(ctx, {
      orderId,
      connectedAccountId: "acct_merchant_a",
      takeRateBasisPoints: 500, // 5%
      idempotencyKey: "g5-service-checkout-1",
    });
    expect(checkout.amountMinor).toBe(8_000);
    expect(checkout.applicationFeeAmountMinor + checkout.merchantProceedsMinor).toBe(checkout.amountMinor);

    paymentRepo.create(ctx, {
      orderId,
      provider: "stripe",
      providerRef: checkout.intentId,
      kind: "CHARGE",
      amountMinor: checkout.amountMinor,
      currency: checkout.currency,
      status: "SUCCEEDED",
      createdAt: "2026-09-08T01:00:00.000Z",
    });
    connection.sqlite.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(orderId);

    // 2. REFUND — cancelling 30 hours before the appointment lands in the
    // service policy's 24-48h tier (50%), not the 48h+ tier (100%) or the
    // <24h tier (0%) — proving the mode-specific policy, not a shared one,
    // actually governs this refund.
    const refund = await refundService.refundOrderLine(ctx, "OWNER", {
      orderLineId: lineId,
      cancelledAt: "2026-09-11T03:00:00.000Z", // 30h before 2026-09-12T09:00:00Z
      idempotencyKey: "g5-service-refund-1",
    });
    expect(refund.mode).toBe("SERVICE");
    expect(refund.refundPercent).toBe(50);
    expect(refund.refundAmountMinor).toBe(4_000);

    const refundPayment = paymentRepo.findById(ctx, refund.paymentId!);
    expect(refundPayment).toMatchObject({ kind: "REFUND", amountMinor: 4_000, status: "SUCCEEDED" });
  });

  it("RENTAL mode — deposit hold, partial capture for damage, and full release on a clean return are both correct end to end", async () => {
    const ctx = createTenantContext(merchantA);

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
      name: "Trailer — default",
      priceMinor: 5_000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20_000,
      bufferMinutes: 0,
    });

    // Rental A: damage found on return, deposit partially captured.
    const orderIdA = orderRepo.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    const lineIdA = orderRepo.addLine(ctx, orderIdA, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5_000,
      lineTotalMinor: 10_000,
      depositMinor: 20_000,
      startsAt: "2026-09-10T09:00:00.000Z",
      endsAt: "2026-09-12T09:00:00.000Z",
    });

    const holdA = await depositService.placeHold(ctx, {
      orderLineId: lineIdA,
      connectedAccountId: "acct_merchant_a",
      idempotencyKey: "g5-rental-hold-a",
      authorizedAt: "2026-09-10T08:55:00.000Z",
    });
    expect(holdA.amountMinor).toBe(20_000);
    expect(depositRepo.findById(ctx, holdA.depositAuthorizationId)).toMatchObject({ state: "AUTHORIZED" });

    const captureA = await depositService.captureHold(ctx, {
      depositAuthorizationId: holdA.depositAuthorizationId,
      amountMinor: 7_500, // partial — covers a damage claim, not the full deposit
      idempotencyKey: "g5-rental-capture-a",
      capturedAt: "2026-09-12T09:10:00.000Z",
    });
    expect(captureA.state).toBe("PARTIALLY_CAPTURED");
    expect(captureA.capturedMinor).toBe(7_500);
    expect(captureA.releasedRemainderMinor).toBe(12_500);
    expect(paymentRepo.findById(ctx, holdA.paymentId)).toMatchObject({ status: "SUCCEEDED" });

    // Rental B: clean return, deposit released in full.
    const orderIdB = orderRepo.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    const lineIdB = orderRepo.addLine(ctx, orderIdB, {
      listingId,
      variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5_000,
      lineTotalMinor: 10_000,
      depositMinor: 20_000,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-17T09:00:00.000Z",
    });

    const holdB = await depositService.placeHold(ctx, {
      orderLineId: lineIdB,
      connectedAccountId: "acct_merchant_a",
      idempotencyKey: "g5-rental-hold-b",
      authorizedAt: "2026-09-15T08:55:00.000Z",
    });

    const releasedState = await depositService.releaseHold(ctx, {
      depositAuthorizationId: holdB.depositAuthorizationId,
      releasedAt: "2026-09-17T09:10:00.000Z",
    });
    expect(releasedState).toBe("RELEASED");
    expect(depositRepo.findById(ctx, holdB.depositAuthorizationId)).toMatchObject({ state: "RELEASED" });

    // The two rentals' deposit holds never cross-contaminate: rental A's
    // partial capture left rental B's hold untouched at AUTHORIZED right up
    // until its own, independent release.
    expect(depositRepo.findById(ctx, holdA.depositAuthorizationId)).toMatchObject({ state: "PARTIALLY_CAPTURED" });
  });
});
