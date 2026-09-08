import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { PaymentRepository } from "../repositories/PaymentRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { SimulatedDepositHoldProvider } from "../payments/SimulatedDepositHoldProvider.js";
import { DepositAuthorizationService, MissingHoldExpiryError } from "./DepositAuthorizationService.js";

describe("DepositAuthorizationService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let paymentRepo: PaymentRepository;
  let depositRepo: DepositAuthorizationRepository;
  let provider: SimulatedDepositHoldProvider;
  let service: DepositAuthorizationService;
  let merchantA: string;
  let merchantB: string;
  let orderLineA: string;
  let orderA: string;

  const now = new Date("2026-09-08T00:00:00.000Z");

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    paymentRepo = new PaymentRepository(connection);
    depositRepo = new DepositAuthorizationRepository(connection);
    provider = new SimulatedDepositHoldProvider(() => now, 7);
    service = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, provider);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    const userA = generateUuidV7();

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
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
    orderLineA = orderRepo.addLine(ctxA, orderA, {
      listingId: listingA,
      variantId: variantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
      depositMinor: 20000,
    });
  });

  it("places a hold for the order line's server-recorded deposit amount and records the provider's expiry", async () => {
    const ctx = createTenantContext(merchantA);

    const result = await service.placeHold(ctx, {
      orderLineId: orderLineA,
      connectedAccountId: "acct_123",
      idempotencyKey: "idem-1",
      authorizedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(result.expiresAt).toBe("2026-09-15T00:00:00.000Z");

    const deposit = depositRepo.findById(ctx, result.depositAuthorizationId);
    expect(deposit).toMatchObject({
      orderLineId: orderLineA,
      amountMinor: 20000,
      currency: "USD",
      state: "AUTHORIZED",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-09-15T00:00:00.000Z",
    });

    const payment = paymentRepo.findById(ctx, result.paymentId);
    expect(payment).toMatchObject({
      orderId: orderA,
      kind: "DEPOSIT_HOLD",
      amountMinor: 20000,
      currency: "USD",
      providerRef: result.intentId,
    });
  });

  it("never trusts a caller-supplied deposit amount — it always reads the order line's own depositMinor", async () => {
    const ctx = createTenantContext(merchantA);

    const result = await service.placeHold(ctx, {
      orderLineId: orderLineA,
      connectedAccountId: "acct_123",
      idempotencyKey: "idem-2",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      // @ts-expect-error — no amountMinor field exists on the input type at all
      amountMinor: 1,
    });

    expect(depositRepo.findById(ctx, result.depositAuthorizationId)).toMatchObject({ amountMinor: 20000 });
  });

  it("throws if the order line has no deposit configured", async () => {
    const ctx = createTenantContext(merchantA);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const listingNoDeposit = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "No Deposit",
      slug: "no-deposit",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantNoDeposit = variantRepo.create(ctx, {
      listingId: listingNoDeposit,
      mode: "PRODUCT",
      sku: "ND-SKU",
      name: "No Deposit - default",
      priceMinor: 1000,
      currency: "USD",
    });
    const lineNoDeposit = orderRepo.addLine(ctx, orderA, {
      listingId: listingNoDeposit,
      variantId: variantNoDeposit,
      mode: "PRODUCT",
      quantity: 1,
      unitPriceMinor: 1000,
      lineTotalMinor: 1000,
    });

    await expect(
      service.placeHold(ctx, {
        orderLineId: lineNoDeposit,
        connectedAccountId: "acct_123",
        idempotencyKey: "idem-3",
        authorizedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("throws MissingHoldExpiryError and persists nothing if the provider response has no expiresAt", async () => {
    const ctx = createTenantContext(merchantA);
    const brokenProvider = {
      createManualCaptureHold: async () => ({
        intentId: "pi_broken",
        clientSecret: "secret",
        amountMinor: 20000,
        currency: "USD",
        expiresAt: "" as unknown as string,
      }),
    };
    const brokenService = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, brokenProvider);

    await expect(
      brokenService.placeHold(ctx, {
        orderLineId: orderLineA,
        connectedAccountId: "acct_123",
        idempotencyKey: "idem-4",
        authorizedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow(MissingHoldExpiryError);

    expect(paymentRepo.findByProviderRef(ctx, "stripe", "pi_broken")).toBeUndefined();
  });

  it("does not let merchant B place a hold against merchant A's order line", async () => {
    const ctxB = createTenantContext(merchantB);

    await expect(
      service.placeHold(ctxB, {
        orderLineId: orderLineA,
        connectedAccountId: "acct_123",
        idempotencyKey: "idem-5",
        authorizedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
