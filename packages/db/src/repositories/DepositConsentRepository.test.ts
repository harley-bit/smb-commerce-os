import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";
import { DepositConsentRepository } from "./DepositConsentRepository.js";

describe("DepositConsentRepository", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let repo: DepositConsentRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let userB: string;
  let orderA: string;
  let orderB: string;
  let orderLineA: string;
  let orderLineB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    repo = new DepositConsentRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    userA = generateUuidV7();
    userB = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userA, email: "a@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
      { id: userB, email: "b@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);

    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });
    orderB = orderRepo.create(ctxB, { customerUserId: userB, status: "CART", currency: "USD" });

    const rentalListingA = listingRepo.create(ctxA, {
      mode: "RENTAL",
      name: "A Rental Listing",
      slug: "a-rental-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    const rentalVariantA = variantRepo.create(ctxA, {
      listingId: rentalListingA,
      mode: "RENTAL",
      sku: "R-A-SKU",
      name: "A Rental Variant",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
    });
    orderLineA = orderRepo.addLine(ctxA, orderA, {
      listingId: rentalListingA,
      variantId: rentalVariantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
      depositMinor: 20000,
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-13T00:00:00.000Z",
    });

    const rentalListingB = listingRepo.create(ctxB, {
      mode: "RENTAL",
      name: "B Rental Listing",
      slug: "b-rental-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    const rentalVariantB = variantRepo.create(ctxB, {
      listingId: rentalListingB,
      mode: "RENTAL",
      sku: "R-B-SKU",
      name: "B Rental Variant",
      priceMinor: 3000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 10000,
    });
    orderLineB = orderRepo.addLine(ctxB, orderB, {
      listingId: rentalListingB,
      variantId: rentalVariantB,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 3000,
      lineTotalMinor: 3000,
      depositMinor: 10000,
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-11T00:00:00.000Z",
    });
  });

  it("record and findLatestForOrderLine are isolated per tenant", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.record(ctxA, {
      orderId: orderA,
      orderLineId: orderLineA,
      customerUserId: userA,
      holdAmountMinor: 20000,
      currency: "USD",
      holdDurationDays: 3,
      acknowledgedAt: "2026-09-09T10:00:00.000Z",
    });
    repo.record(ctxB, {
      orderId: orderB,
      orderLineId: orderLineB,
      customerUserId: userB,
      holdAmountMinor: 10000,
      currency: "USD",
      holdDurationDays: 1,
      acknowledgedAt: "2026-09-09T11:00:00.000Z",
    });

    const foundA = repo.findLatestForOrderLine(ctxA, orderLineA);
    const foundB = repo.findLatestForOrderLine(ctxB, orderLineB);
    expect(foundA?.holdAmountMinor).toBe(20000);
    expect(foundB?.holdAmountMinor).toBe(10000);

    // Merchant B's context must not see merchant A's consent even by order-line id lookup under its own scope.
    expect(repo.findLatestForOrderLine(ctxB, orderLineA)).toBeUndefined();
    expect(repo.findLatestForOrderLine(ctxA, orderLineB)).toBeUndefined();
  });

  it("returns the most recent consent when a customer re-acknowledges", () => {
    const ctxA = createTenantContext(merchantA);
    repo.record(ctxA, {
      orderId: orderA,
      orderLineId: orderLineA,
      customerUserId: userA,
      holdAmountMinor: 20000,
      currency: "USD",
      holdDurationDays: 3,
      acknowledgedAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record(ctxA, {
      orderId: orderA,
      orderLineId: orderLineA,
      customerUserId: userA,
      holdAmountMinor: 20000,
      currency: "USD",
      holdDurationDays: 3,
      acknowledgedAt: "2026-09-09T10:00:00.000Z",
    });

    const latest = repo.findLatestForOrderLine(ctxA, orderLineA);
    expect(latest?.acknowledgedAt).toBe("2026-09-09T10:00:00.000Z");
  });
});
