import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { LocationRepository } from "./LocationRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { InventoryUnitRepository } from "./InventoryUnitRepository.js";

describe("InventoryUnitRepository", () => {
  let connection: Connection;
  let repo: InventoryUnitRepository;
  let merchantA: string;
  let merchantB: string;
  let variantA: string;
  let variantB: string;
  let locationA: string;
  let locationB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new InventoryUnitRepository(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const locationRepo = new LocationRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();

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

  it("creates a SERIALIZED unit in AVAILABLE status", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "SN-001",
      trackingMode: "SERIALIZED",
    });

    expect(repo.findById(ctx, id)).toMatchObject({
      id,
      unitCode: "SN-001",
      trackingMode: "SERIALIZED",
      status: "AVAILABLE",
    });
  });

  it("creates a FUNGIBLE unit in AVAILABLE status", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "POOL-001",
      trackingMode: "FUNGIBLE",
    });

    expect(repo.findById(ctx, id)).toMatchObject({ trackingMode: "FUNGIBLE", status: "AVAILABLE" });
  });

  it("listByVariant() only returns the caller's own units — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, { variantId: variantA, locationId: locationA, unitCode: "A-1", trackingMode: "SERIALIZED" });
    repo.create(ctxB, { variantId: variantB, locationId: locationB, unitCode: "B-1", trackingMode: "SERIALIZED" });

    expect(repo.listByVariant(ctxA, variantA).map((u) => u.unitCode)).toEqual(["A-1"]);
    expect(repo.listByVariant(ctxB, variantB).map((u) => u.unitCode)).toEqual(["B-1"]);
  });

  it("findById() cannot see another merchant's unit for a same-shaped id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxB, {
      variantId: variantB,
      locationId: locationB,
      unitCode: "B-1",
      trackingMode: "SERIALIZED",
    });

    expect(repo.findById(ctxA, id)).toBeUndefined();
  });

  it("updateStatus() changes status and sets retiredAt only when transitioning to RETIRED", () => {
    const ctx = createTenantContext(merchantA);
    const id = repo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "A-1",
      trackingMode: "SERIALIZED",
    });

    repo.updateStatus(ctx, id, "SOLD", "2026-09-08T01:00:00.000Z");
    expect(repo.findById(ctx, id)).toMatchObject({ status: "SOLD", retiredAt: null });

    const id2 = repo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "A-2",
      trackingMode: "SERIALIZED",
    });
    repo.updateStatus(ctx, id2, "RETIRED", "2026-09-08T02:00:00.000Z");
    expect(repo.findById(ctx, id2)).toMatchObject({ status: "RETIRED", retiredAt: "2026-09-08T02:00:00.000Z" });
  });

  it("update() patches unitCode/locationId/expectedLifeMonths/conditionGrade", () => {
    const ctx = createTenantContext(merchantA);
    const id = repo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "A-1",
      trackingMode: "SERIALIZED",
    });

    repo.update(ctx, id, { unitCode: "A-1-RELABELED", expectedLifeMonths: 24, conditionGrade: "B" });

    expect(repo.findById(ctx, id)).toMatchObject({
      unitCode: "A-1-RELABELED",
      expectedLifeMonths: 24,
      conditionGrade: "B",
    });
  });

  it("update() is tenant-scoped — cannot change another merchant's unit", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxB, {
      variantId: variantB,
      locationId: locationB,
      unitCode: "B-1",
      trackingMode: "SERIALIZED",
    });

    repo.update(ctxA, id, { unitCode: "HIJACKED" });

    expect(repo.findById(ctxB, id)).toMatchObject({ unitCode: "B-1" });
  });

  it("updateStatus() is tenant-scoped — cannot change another merchant's unit", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxB, {
      variantId: variantB,
      locationId: locationB,
      unitCode: "B-1",
      trackingMode: "SERIALIZED",
    });

    repo.updateStatus(ctxA, id, "SOLD", "2026-09-08T01:00:00.000Z");

    expect(repo.findById(ctxB, id)).toMatchObject({ status: "AVAILABLE" });
  });
});
