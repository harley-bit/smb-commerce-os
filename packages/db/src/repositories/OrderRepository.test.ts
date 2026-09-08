import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";

describe("OrderRepository", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let repo: OrderRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let userB: string;
  let listingA: string;
  let variantA: string;
  let listingB: string;
  let variantB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    repo = new OrderRepository(connection);

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
        createdAt: "2026-09-08T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userA, email: "a@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
      { id: userB, email: "b@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    listingA = listingRepo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Listing",
      slug: "a-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantA = variantRepo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 1000,
      currency: "USD",
    });

    listingB = listingRepo.create(ctxB, {
      mode: "PRODUCT",
      name: "B Listing",
      slug: "b-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantB = variantRepo.create(ctxB, {
      listingId: listingB,
      mode: "PRODUCT",
      sku: "B-SKU",
      name: "B Variant",
      priceMinor: 2000,
      currency: "USD",
    });
  });

  it("creates an order scoped to the caller's merchant with zeroed totals", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, { customerUserId: userA, status: "CART", currency: "USD" });

    expect(repo.findById(ctx, id)).toMatchObject({
      id,
      merchantId: merchantA,
      status: "CART",
      subtotalMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
    });
  });

  it("findById() returns undefined for another merchant's order id — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const idA = repo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });
    const idB = repo.create(ctxB, { customerUserId: userB, status: "CART", currency: "USD" });

    expect(repo.findById(ctxB, idA)).toBeUndefined();
    expect(repo.findById(ctxA, idB)).toBeUndefined();
  });

  it("addLine() and listLines() are scoped per merchant — a caller never sees another tenant's order lines", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const orderA = repo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });
    const orderB = repo.create(ctxB, { customerUserId: userB, status: "CART", currency: "USD" });

    repo.addLine(ctxA, orderA, {
      listingId: listingA,
      variantId: variantA,
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1000,
      lineTotalMinor: 2000,
    });
    repo.addLine(ctxB, orderB, {
      listingId: listingB,
      variantId: variantB,
      mode: "PRODUCT",
      quantity: 1,
      unitPriceMinor: 2000,
      lineTotalMinor: 2000,
    });

    expect(repo.listLines(ctxA, orderA)).toHaveLength(1);
    expect(repo.listLines(ctxB, orderA)).toEqual([]);
    expect(repo.listLines(ctxA, orderB)).toEqual([]);
    expect(repo.listLines(ctxB, orderB)).toHaveLength(1);
  });

  it("updateTotals() cannot modify another merchant's order", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const orderA = repo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });

    repo.updateTotals(ctxB, orderA, { subtotalMinor: 9999, taxMinor: 0, totalMinor: 9999 });

    expect(repo.findById(ctxA, orderA)).toMatchObject({ subtotalMinor: 0, totalMinor: 0 });
  });

  it("updateTotals() updates totals for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const orderA = repo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });
    repo.updateTotals(ctxA, orderA, { subtotalMinor: 2000, taxMinor: 100, totalMinor: 2100 });

    expect(repo.findById(ctxA, orderA)).toMatchObject({
      subtotalMinor: 2000,
      taxMinor: 100,
      totalMinor: 2100,
    });
  });
});
