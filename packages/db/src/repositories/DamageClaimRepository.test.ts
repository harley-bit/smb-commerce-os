import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";
import { DamageClaimRepository } from "./DamageClaimRepository.js";

describe("DamageClaimRepository", () => {
  let connection: Connection;
  let claims: DamageClaimRepository;
  let merchantA: string;
  let merchantB: string;
  let orderLineA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const orderRepo = new OrderRepository(connection);
    claims = new DamageClaimRepository(connection);

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
  });

  it("creates a claim and reads it back", () => {
    const ctx = createTenantContext(merchantA);
    const id = claims.create(ctx, {
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    const claim = claims.findById(ctx, id);
    expect(claim).toMatchObject({
      id,
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      resolvedAt: null,
      resolutionNote: null,
    });
  });

  it("updateState() moves the claim to a new state and can set resolvedAt/resolutionNote", () => {
    const ctx = createTenantContext(merchantA);
    const id = claims.create(ctx, {
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    claims.updateState(ctx, id, {
      state: "RESOLVED_WAIVED",
      resolvedAt: "2026-09-11T09:00:00.000Z",
      resolutionNote: "Waived as goodwill gesture.",
    });

    const claim = claims.findById(ctx, id);
    expect(claim).toMatchObject({
      state: "RESOLVED_WAIVED",
      resolvedAt: "2026-09-11T09:00:00.000Z",
      resolutionNote: "Waived as goodwill gesture.",
    });
  });

  it("does not let merchant B read or update merchant A's claim", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const id = claims.create(ctxA, {
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    expect(claims.findById(ctxB, id)).toBeUndefined();
    expect(() =>
      claims.updateState(ctxB, id, { state: "RESOLVED_WAIVED", resolvedAt: null, resolutionNote: null }),
    ).toThrow();
  });

  it("does not let merchant B list merchant A's claims by order line", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    claims.create(ctxA, {
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    expect(claims.listByOrderLine(ctxA, orderLineA)).toHaveLength(1);
    expect(claims.listByOrderLine(ctxB, orderLineA)).toHaveLength(0);
  });

  it("does not let merchant B notifyCustomer/dispute/resolve merchant A's claim", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    const id = claims.create(ctxA, {
      orderLineId: orderLineA,
      amountMinor: 5000,
      state: "FILED",
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    expect(() => claims.notifyCustomer(ctxB, id)).toThrow();
    expect(() => claims.dispute(ctxB, id)).toThrow();
    expect(() => claims.resolveCaptured(ctxB, id, "2026-09-11T09:00:00.000Z", null)).toThrow();
    expect(() => claims.resolveWaived(ctxB, id, "2026-09-11T09:00:00.000Z", null)).toThrow();

    claims.notifyCustomer(ctxA, id);
    expect(claims.findById(ctxA, id)?.state).toBe("CUSTOMER_NOTIFIED");
  });
});
