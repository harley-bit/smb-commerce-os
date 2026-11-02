import { createTenantContext, generateUuidV7, IllegalDepositTransitionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";
import { DepositAuthorizationRepository } from "./DepositAuthorizationRepository.js";

describe("DepositAuthorizationRepository", () => {
  let connection: Connection;
  let deposits: DepositAuthorizationRepository;
  let merchantA: string;
  let merchantB: string;
  let orderLineA: string;
  let paymentA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const orderRepo = new OrderRepository(connection);
    deposits = new DepositAuthorizationRepository(connection);

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
    const orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
    orderLineA = orderRepo.addLine(ctxA, orderA, {
      listingId: listingA,
      variantId: variantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });

    paymentA = generateUuidV7();
    await connection.db.insert(sqliteSchema.payments).values({
      id: paymentA,
      merchantId: merchantA,
      orderId: orderA,
      provider: "stripe",
      providerRef: "pi_test_123",
      kind: "DEPOSIT_HOLD",
      amountMinor: 20000,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  function createAuthorized(amountMinor = 20000) {
    const ctx = createTenantContext(merchantA);
    return deposits.create(ctx, {
      orderLineId: orderLineA,
      paymentId: paymentA,
      amountMinor,
      currency: "USD",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });
  }

  it("creates an authorization in AUTHORIZED state and reads it back", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized();

    const row = deposits.findById(ctx, id);
    expect(row).toMatchObject({
      id,
      orderLineId: orderLineA,
      paymentId: paymentA,
      amountMinor: 20000,
      state: "AUTHORIZED",
      capturedMinor: null,
      releasedAt: null,
    });
  });

  it("captures the full authorized amount and moves to CAPTURED", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    const nextState = deposits.capture(ctx, id, 20000);

    expect(nextState).toBe("CAPTURED");
    expect(deposits.findById(ctx, id)).toMatchObject({ state: "CAPTURED", capturedMinor: 20000 });
  });

  it("rejects a second capture attempt on an already-captured deposit", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    deposits.capture(ctx, id, 20000);

    expect(() => deposits.capture(ctx, id, 20000)).toThrow(IllegalDepositTransitionError);
    // The first capture's write is untouched by the rejected second attempt.
    expect(deposits.findById(ctx, id)).toMatchObject({ state: "CAPTURED", capturedMinor: 20000 });
  });

  it("rejects a capture amount above the authorized amount", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    expect(() => deposits.capture(ctx, id, 20001)).toThrow(IllegalDepositTransitionError);
    expect(deposits.findById(ctx, id)).toMatchObject({ state: "AUTHORIZED", capturedMinor: null });
  });

  it("rejects capturing an already-released deposit", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    deposits.release(ctx, id, "2026-09-09T00:00:00.000Z");

    expect(() => deposits.capture(ctx, id, 20000)).toThrow(IllegalDepositTransitionError);
  });

  it("allows a partial capture and can be read back as PARTIALLY_CAPTURED", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    const nextState = deposits.capture(ctx, id, 5000);

    expect(nextState).toBe("PARTIALLY_CAPTURED");
    expect(deposits.findById(ctx, id)).toMatchObject({ state: "PARTIALLY_CAPTURED", capturedMinor: 5000 });
  });

  it("releases an authorized deposit", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized();

    deposits.release(ctx, id, "2026-09-09T00:00:00.000Z");

    expect(deposits.findById(ctx, id)).toMatchObject({
      state: "RELEASED",
      releasedAt: "2026-09-09T00:00:00.000Z",
    });
  });

  it("expires an authorized deposit", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized();

    deposits.expire(ctx, id);

    expect(deposits.findById(ctx, id)).toMatchObject({ state: "EXPIRED" });
  });

  it("finds the deposit authorization for an order line", () => {
    const ctx = createTenantContext(merchantA);
    const id = createAuthorized(20000);

    expect(deposits.findByOrderLineId(ctx, orderLineA)).toMatchObject({ id, orderLineId: orderLineA });
  });

  it("returns undefined when an order line has no deposit authorization", () => {
    const ctx = createTenantContext(merchantA);

    expect(deposits.findByOrderLineId(ctx, "no-such-order-line")).toBeUndefined();
  });

  it("does not let merchant B find merchant A's deposit authorization by order line", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    createAuthorized(20000);

    expect(deposits.findByOrderLineId(ctxB, orderLineA)).toBeUndefined();
    expect(deposits.findByOrderLineId(ctxA, orderLineA)).toBeDefined();
  });

  it("lists all deposit authorizations for a merchant, ordered by soonest expiry first", () => {
    const ctx = createTenantContext(merchantA);
    const laterId = deposits.create(ctx, {
      orderLineId: orderLineA,
      paymentId: paymentA,
      amountMinor: 5000,
      currency: "USD",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-11-08T00:00:00.000Z",
    });
    const soonerId = deposits.create(ctx, {
      orderLineId: orderLineA,
      paymentId: paymentA,
      amountMinor: 3000,
      currency: "USD",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-09-09T00:00:00.000Z",
    });

    const rows = deposits.listAll(ctx);

    expect(rows.map((row) => row.id)).toEqual([soonerId, laterId]);
  });

  it("does not let merchant B list merchant A's deposit authorizations", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    createAuthorized(20000);

    expect(deposits.listAll(ctxA)).toHaveLength(1);
    expect(deposits.listAll(ctxB)).toHaveLength(0);
  });

  it("does not let merchant B create, read, capture, release, or expire merchant A's deposit authorization", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const id = deposits.create(ctxA, {
      orderLineId: orderLineA,
      paymentId: paymentA,
      amountMinor: 20000,
      currency: "USD",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });

    expect(deposits.findById(ctxB, id)).toBeUndefined();
    expect(() => deposits.capture(ctxB, id, 20000)).toThrow();
    expect(() => deposits.release(ctxB, id, "2026-09-09T00:00:00.000Z")).toThrow();
    expect(() => deposits.expire(ctxB, id)).toThrow();

    // Merchant A's row is untouched by merchant B's rejected attempts.
    expect(deposits.findById(ctxA, id)).toMatchObject({ state: "AUTHORIZED" });
  });
});
