import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { LocationRepository } from "./LocationRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { InventoryMovementRepository } from "./InventoryMovementRepository.js";

describe("InventoryMovementRepository", () => {
  let connection: Connection;
  let repo: InventoryMovementRepository;
  let merchantA: string;
  let merchantB: string;
  let variantA: string;
  let variantB: string;
  let locationA: string;
  let locationB: string;
  let userId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new InventoryMovementRepository(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const locationRepo = new LocationRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
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
      { id: userId, email: "staff@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const listingA = listingRepo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Listing",
      slug: "a-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const listingB = listingRepo.create(ctxB, {
      mode: "PRODUCT",
      name: "B Listing",
      slug: "b-listing",
      status: "DRAFT",
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
    variantB = variantRepo.create(ctxB, {
      listingId: listingB,
      mode: "PRODUCT",
      sku: "B-SKU",
      name: "B Variant",
      priceMinor: 1000,
      currency: "USD",
    });

    locationA = locationRepo.create(ctxA, { name: "Main", timezone: "America/New_York" });
    locationB = locationRepo.create(ctxB, { name: "Main", timezone: "America/New_York" });
  });

  it("records a RECEIPT movement scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity: 10,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "Initial stock delivery",
    });

    expect(repo.listByVariant(ctx, variantA)).toMatchObject([
      { id, kind: "RECEIPT", quantity: 10, note: "Initial stock delivery" },
    ]);
  });

  it("stock is the sum of the ledger across mixed movement kinds", () => {
    const ctx = createTenantContext(merchantA);

    repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity: 20,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "Initial delivery",
    });
    repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "SALE",
      quantity: -3,
      occurredAt: "2026-09-08T01:00:00.000Z",
      actorUserId: userId,
      note: "Order #1",
    });
    repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "ADJUSTMENT",
      quantity: -1,
      occurredAt: "2026-09-08T02:00:00.000Z",
      actorUserId: userId,
      note: "Damaged unit written down",
    });
    repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity: 5,
      occurredAt: "2026-09-08T03:00:00.000Z",
      actorUserId: userId,
      note: "Second delivery",
    });

    expect(repo.sumStock(ctx, variantA)).toBe(21);
  });

  it("sumStock() returns 0 for a variant with no movements", () => {
    const ctx = createTenantContext(merchantA);

    expect(repo.sumStock(ctx, variantA)).toBe(0);
  });

  it("sumStock() scopes by location when a location is given", () => {
    const ctx = createTenantContext(merchantA);
    const otherLocation = new LocationRepository(connection).create(ctx, {
      name: "Warehouse",
      timezone: "America/New_York",
    });

    repo.record(ctx, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity: 10,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "Store stock",
    });
    repo.record(ctx, {
      variantId: variantA,
      locationId: otherLocation,
      kind: "RECEIPT",
      quantity: 7,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "Warehouse stock",
    });

    expect(repo.sumStock(ctx, variantA)).toBe(17);
    expect(repo.sumStock(ctx, variantA, locationA)).toBe(10);
    expect(repo.sumStock(ctx, variantA, otherLocation)).toBe(7);
  });

  it("listByVariant() only returns the caller's own movements — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.record(ctxA, {
      variantId: variantA,
      locationId: locationA,
      kind: "RECEIPT",
      quantity: 10,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "A stock",
    });
    repo.record(ctxB, {
      variantId: variantB,
      locationId: locationB,
      kind: "RECEIPT",
      quantity: 99,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "B stock",
    });

    expect(repo.listByVariant(ctxA, variantA).map((m) => m.quantity)).toEqual([10]);
    expect(repo.listByVariant(ctxB, variantB).map((m) => m.quantity)).toEqual([99]);
  });

  it("sumStock() cannot see another merchant's movements for a same-shaped variant id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.record(ctxB, {
      variantId: variantB,
      locationId: locationB,
      kind: "RECEIPT",
      quantity: 50,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: userId,
      note: "B stock",
    });

    expect(repo.sumStock(ctxA, variantB)).toBe(0);
  });
});
