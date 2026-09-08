import { createTenantContext, DuplicatePaymentReferenceError, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { OrderRepository } from "./OrderRepository.js";
import { PaymentRepository } from "./PaymentRepository.js";

describe("PaymentRepository", () => {
  let connection: Connection;
  let payments: PaymentRepository;
  let merchantA: string;
  let merchantB: string;
  let orderA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const orderRepo = new OrderRepository(connection);
    payments = new PaymentRepository(connection);

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
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
  });

  function createPayment(providerRef = "pi_test_123") {
    const ctx = createTenantContext(merchantA);
    return payments.create(ctx, {
      orderId: orderA,
      provider: "STRIPE",
      providerRef,
      kind: "CHARGE",
      amountMinor: 2500,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  }

  it("creates a payment and reads it back", () => {
    const ctx = createTenantContext(merchantA);
    const id = createPayment();

    expect(payments.findById(ctx, id)).toMatchObject({
      orderId: orderA,
      provider: "STRIPE",
      providerRef: "pi_test_123",
      status: "SUCCEEDED",
    });
  });

  it("finds a payment by (provider, provider_ref) — the webhook idempotency lookup", () => {
    const ctx = createTenantContext(merchantA);
    const id = createPayment("pi_lookup_1");

    expect(payments.findByProviderRef(ctx, "STRIPE", "pi_lookup_1")).toMatchObject({ id });
    expect(payments.findByProviderRef(ctx, "STRIPE", "pi_does_not_exist")).toBeUndefined();
  });

  it("rejects a duplicate (provider, provider_ref) with a domain error — the idempotency anchor", () => {
    createPayment("pi_dupe");

    expect(() => createPayment("pi_dupe")).toThrow(DuplicatePaymentReferenceError);
    // Only the first row exists; the rejected duplicate wrote nothing.
    const ctx = createTenantContext(merchantA);
    expect(payments.findByProviderRef(ctx, "STRIPE", "pi_dupe")).toBeDefined();
  });

  it("allows the same provider_ref across two different providers", () => {
    const ctx = createTenantContext(merchantA);
    payments.create(ctx, {
      orderId: orderA,
      provider: "STRIPE",
      providerRef: "ref-shared",
      kind: "CHARGE",
      amountMinor: 2500,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() =>
      payments.create(ctx, {
        orderId: orderA,
        provider: "OTHER_PROVIDER",
        providerRef: "ref-shared",
        kind: "CHARGE",
        amountMinor: 2500,
        currency: "USD",
        status: "SUCCEEDED",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("does not let merchant B create, read, or look up merchant A's payment", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const idA = payments.create(ctxA, {
      orderId: orderA,
      provider: "STRIPE",
      providerRef: "pi_isolated",
      kind: "CHARGE",
      amountMinor: 2500,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(payments.findById(ctxB, idA)).toBeUndefined();
    expect(payments.findByProviderRef(ctxB, "STRIPE", "pi_isolated")).toBeUndefined();

    // Merchant A can still see its own payment through both lookups.
    expect(payments.findById(ctxA, idA)).toMatchObject({ id: idA });
    expect(payments.findByProviderRef(ctxA, "STRIPE", "pi_isolated")).toMatchObject({ id: idA });
  });

  describe("applyProviderEvent — D093 webhook ordering tolerance", () => {
    it("applies a status update from a provider event and records its timestamp", () => {
      const ctx = createTenantContext(merchantA);
      const id = createPayment("pi_order_1");

      payments.applyProviderEvent(ctx, id, { status: "REFUNDED", occurredAt: "2026-09-08T01:00:00.000Z" });

      expect(payments.findById(ctx, id)).toMatchObject({
        status: "REFUNDED",
        lastEventAt: "2026-09-08T01:00:00.000Z",
      });
    });

    it("ignores an out-of-order event delivered after a chronologically later one already applied", () => {
      const ctx = createTenantContext(merchantA);
      const id = createPayment("pi_order_2");

      // A later event ("REFUNDED" at 01:00) is delivered first...
      payments.applyProviderEvent(ctx, id, { status: "REFUNDED", occurredAt: "2026-09-08T01:00:00.000Z" });
      // ...then an earlier event ("FAILED" at 00:30) arrives late. Arrival
      // order must not be allowed to regress the already-applied state.
      payments.applyProviderEvent(ctx, id, { status: "FAILED", occurredAt: "2026-09-08T00:30:00.000Z" });

      expect(payments.findById(ctx, id)).toMatchObject({
        status: "REFUNDED",
        lastEventAt: "2026-09-08T01:00:00.000Z",
      });
    });

    it("produces the same final state regardless of the order two events are delivered in", () => {
      const ctx = createTenantContext(merchantA);
      const inOrderId = createPayment("pi_order_3a");
      const reversedId = createPayment("pi_order_3b");

      const early = { status: "FAILED" as const, occurredAt: "2026-09-08T00:00:00.000Z" };
      const late = { status: "REFUNDED" as const, occurredAt: "2026-09-08T00:10:00.000Z" };

      payments.applyProviderEvent(ctx, inOrderId, early);
      payments.applyProviderEvent(ctx, inOrderId, late);

      payments.applyProviderEvent(ctx, reversedId, late);
      payments.applyProviderEvent(ctx, reversedId, early);

      const inOrderResult = payments.findById(ctx, inOrderId);
      const reversedResult = payments.findById(ctx, reversedId);
      expect(inOrderResult?.status).toBe(reversedResult?.status);
      expect(inOrderResult?.lastEventAt).toBe(reversedResult?.lastEventAt);
      expect(reversedResult).toMatchObject({ status: "REFUNDED", lastEventAt: late.occurredAt });
    });

    it("does not let merchant B apply a provider event to merchant A's payment", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const id = createPayment("pi_order_isolated");

      expect(() =>
        payments.applyProviderEvent(ctxB, id, { status: "REFUNDED", occurredAt: "2026-09-08T01:00:00.000Z" }),
      ).toThrow();

      // Merchant A's own event still applies normally.
      payments.applyProviderEvent(ctxA, id, { status: "REFUNDED", occurredAt: "2026-09-08T01:00:00.000Z" });
      expect(payments.findById(ctxA, id)).toMatchObject({ status: "REFUNDED" });
    });
  });
});
