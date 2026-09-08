import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { CartService } from "./CartService.js";

describe("CartService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let variantRepo: VariantRepository;
  let service: CartService;
  let merchantA: string;
  let userId: string;
  let variantA: string;
  let variantB: string;
  let serviceVariant: string;
  let eurVariant: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    service = new CartService(orderRepo, variantRepo);

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
      priceMinor: 2500,
      currency: "USD",
    });

    const listingB = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "B Listing",
      slug: "b-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantB = variantRepo.create(ctx, {
      listingId: listingB,
      mode: "PRODUCT",
      sku: "B-SKU",
      name: "B Variant",
      priceMinor: 750,
      currency: "USD",
    });

    const serviceListing = listingRepo.create(ctx, {
      mode: "SERVICE",
      name: "A Service Listing",
      slug: "a-service-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    serviceVariant = variantRepo.create(ctx, {
      listingId: serviceListing,
      mode: "SERVICE",
      sku: "S-SKU",
      name: "A Service Variant",
      priceMinor: 9000,
      currency: "USD",
      durationMinutes: 60,
    });

    const eurListing = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "EUR Listing",
      slug: "eur-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    eurVariant = variantRepo.create(ctx, {
      listingId: eurListing,
      mode: "PRODUCT",
      sku: "EUR-SKU",
      name: "EUR Variant",
      priceMinor: 1000,
      currency: "EUR",
    });
  });

  it("creates a cart in CART status with zeroed totals", () => {
    const ctx = createTenantContext(merchantA);

    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    expect(orderRepo.findById(ctx, cartId)).toMatchObject({
      status: "CART",
      currency: "USD",
      subtotalMinor: 0,
      totalMinor: 0,
    });
  });

  it("adds a product line using the server-side variant price and ignores a client-supplied price", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    const tamperedInput = {
      cartId,
      variantId: variantA,
      quantity: 2,
      // A malicious/buggy client payload attempting to override price.
      unitPriceMinor: 1,
      lineTotalMinor: 1,
    };

    const result = service.addProductLine(ctx, tamperedInput as never);

    expect(result.unitPriceMinor).toBe(2500);
    expect(result.lineTotalMinor).toBe(5000);
    expect(result.currency).toBe("USD");
  });

  it("recomputes cart totals server-side after every mutation, not just the first", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    service.addProductLine(ctx, { cartId, variantId: variantA, quantity: 2 });
    expect(orderRepo.findById(ctx, cartId)).toMatchObject({
      subtotalMinor: 5000,
      taxMinor: 0,
      totalMinor: 5000,
    });

    service.addProductLine(ctx, { cartId, variantId: variantB, quantity: 3 });
    expect(orderRepo.findById(ctx, cartId)).toMatchObject({
      subtotalMinor: 7250,
      taxMinor: 0,
      totalMinor: 7250,
    });
  });

  it("ignores a client-supplied cart total even when it disagrees with the recomputed value", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    // Directly corrupt the stored total the way a compromised client write
    // path might, then prove the next mutation overwrites it from scratch.
    orderRepo.updateTotals(ctx, cartId, { subtotalMinor: 999999, taxMinor: 0, totalMinor: 999999 });

    service.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 });

    expect(orderRepo.findById(ctx, cartId)).toMatchObject({
      subtotalMinor: 2500,
      totalMinor: 2500,
    });
  });

  it("rejects a non-PRODUCT variant", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    expect(() =>
      service.addProductLine(ctx, { cartId, variantId: serviceVariant, quantity: 1 }),
    ).toThrow(/PRODUCT/);
  });

  it("rejects a variant whose currency does not match the cart's currency", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });

    expect(() => service.addProductLine(ctx, { cartId, variantId: eurVariant, quantity: 1 })).toThrow();
  });

  it("rejects adding a line to an order that is no longer a cart", () => {
    const ctx = createTenantContext(merchantA);
    const cartId = service.createCart(ctx, { customerUserId: userId, currency: "USD" });
    orderRepo.updateTotals(ctx, cartId, { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
    connection.sqlite
      .prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?")
      .run(cartId);

    expect(() =>
      service.addProductLine(ctx, { cartId, variantId: variantA, quantity: 1 }),
    ).toThrow(/CART/);
  });

  it("rejects a non-existent cart", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.addProductLine(ctx, { cartId: "does-not-exist", variantId: variantA, quantity: 1 }),
    ).toThrow(/not found/);
  });
});
