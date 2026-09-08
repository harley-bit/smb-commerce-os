import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { CartService } from "./CartService.js";
import { CheckoutPaymentService } from "./CheckoutPaymentService.js";
import { SimulatedPaymentIntentProvider } from "../payments/SimulatedPaymentIntentProvider.js";

describe("CheckoutPaymentService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let cartService: CartService;
  let provider: SimulatedPaymentIntentProvider;
  let service: CheckoutPaymentService;
  let merchantA: string;
  let userId: string;
  let variantA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    cartService = new CartService(orderRepo, variantRepo);
    provider = new SimulatedPaymentIntentProvider();
    service = new CheckoutPaymentService(orderRepo, provider);

    merchantA = generateUuidV7();
    userId = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userId, email: "customer@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    const listingA = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "A Listing",
      slug: "a-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantA = variantRepo.create(ctx, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 10_000,
      currency: "USD",
    });
  });

  it("D089 acceptance criteria: the application-fee split lands correctly on a test transaction", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });

    const result = await service.createCheckoutIntent(ctx, {
      orderId: cartId,
      connectedAccountId: "acct_merchant_a",
      takeRateBasisPoints: 250, // 2.5%
      idempotencyKey: "idem-1",
    });

    expect(result.amountMinor).toBe(10_000);
    expect(result.currency).toBe("USD");
    expect(result.connectedAccountId).toBe("acct_merchant_a");
    expect(result.applicationFeeAmountMinor).toBe(250);
    expect(result.merchantProceedsMinor).toBe(9_750);

    // The split the provider actually recorded on the PaymentIntent must
    // match what the service reported back, and must sum to the charge.
    const recorded = provider.getRecordedIntent(result.intentId);
    expect(recorded?.applicationFeeAmountMinor).toBe(250);
    expect(recorded?.amountMinor).toBe(10_000);
    expect(recorded?.connectedAccountId).toBe("acct_merchant_a");
  });

  it("D090 acceptance criteria: a replayed request with the same Idempotency-Key returns the original result, no duplicate PaymentIntent", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });

    const input = {
      orderId: cartId,
      connectedAccountId: "acct_merchant_a",
      takeRateBasisPoints: 250,
      idempotencyKey: "idem-retry-1",
    };

    const first = await service.createCheckoutIntent(ctx, input);
    const replay = await service.createCheckoutIntent(ctx, input);

    expect(replay).toEqual(first);
    expect(provider.intentCount()).toBe(1);
  });

  it("D090 security check: rejects checkout with a missing Idempotency-Key", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });

    await expect(
      service.createCheckoutIntent(ctx, {
        orderId: cartId,
        connectedAccountId: "acct_merchant_a",
        takeRateBasisPoints: 250,
        idempotencyKey: "",
      }),
    ).rejects.toThrow(/idempotency/i);
  });

  it("computes the amount from the server-recorded order total, not a client-supplied amount", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });

    const tamperedInput = {
      orderId: cartId,
      connectedAccountId: "acct_merchant_a",
      takeRateBasisPoints: 250,
      idempotencyKey: "idem-tampered",
      // A malicious/buggy caller attempting to override the charge amount.
      amountMinor: 1,
    };

    const result = await service.createCheckoutIntent(ctx, tamperedInput as never);

    expect(result.amountMinor).toBe(10_000);
  });

  it("rejects checkout for an order with nothing in it", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });

    await expect(
      service.createCheckoutIntent(ctx, {
        orderId: cartId,
        connectedAccountId: "acct_merchant_a",
        takeRateBasisPoints: 250,
        idempotencyKey: "idem-empty-cart",
      }),
    ).rejects.toThrow(/empty|zero|total/i);
  });

  it("rejects checkout for an order that is not in CART status", async () => {
    const ctx = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctx, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });
    connection.sqlite.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(cartId);

    await expect(
      service.createCheckoutIntent(ctx, {
        orderId: cartId,
        connectedAccountId: "acct_merchant_a",
        takeRateBasisPoints: 250,
        idempotencyKey: "idem-wrong-status",
      }),
    ).rejects.toThrow(/CART/);
  });

  it("rejects a non-existent order", async () => {
    const ctx = createTenantContext(merchantA);

    await expect(
      service.createCheckoutIntent(ctx, {
        orderId: "does-not-exist",
        connectedAccountId: "acct_merchant_a",
        takeRateBasisPoints: 250,
        idempotencyKey: "idem-nonexistent-order",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("does not leak an order from another tenant", async () => {
    const merchantB = generateUuidV7();
    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);

    const ctxA = createTenantContext(merchantA);
    const cartId = cartService.createCart(ctxA, { customerUserId: userId, currency: "USD" });
    cartService.addProductLine(ctxA, { cartId, variantId: variantA, quantity: 1 });

    const ctxB = createTenantContext(merchantB);
    await expect(
      service.createCheckoutIntent(ctxB, {
        orderId: cartId,
        connectedAccountId: "acct_merchant_b",
        takeRateBasisPoints: 250,
        idempotencyKey: "idem-cross-tenant",
      }),
    ).rejects.toThrow(/not found/);
  });
});
