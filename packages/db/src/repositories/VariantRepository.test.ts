import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";

describe("VariantRepository", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let repo: VariantRepository;
  let merchantA: string;
  let merchantB: string;
  let listingA: string;
  let listingB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    repo = new VariantRepository(connection);

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
    listingA = listingRepo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Listing",
      slug: "a-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    listingB = listingRepo.create(ctxB, {
      mode: "PRODUCT",
      name: "B Listing",
      slug: "b-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("creates a variant scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });

    const variant = repo.findById(ctx, id);
    expect(variant).toMatchObject({
      id,
      merchantId: merchantA,
      listingId: listingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      priceMinor: 1999,
    });
  });

  it("listByListing() only returns the caller's own variants — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });
    repo.create(ctxB, {
      listingId: listingB,
      mode: "PRODUCT",
      sku: "B-SKU",
      name: "B Variant",
      priceMinor: 200,
      currency: "USD",
    });

    expect(repo.listByListing(ctxA, listingA).map((v) => v.sku)).toEqual(["A-SKU"]);
    expect(repo.listByListing(ctxB, listingB).map((v) => v.sku)).toEqual(["B-SKU"]);
  });

  it("findById() returns undefined for another merchant's variant id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's variant", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });

    repo.update(ctxB, id, { name: "Hijacked" });

    expect(repo.findById(ctxA, id)?.name).toBe("A Variant");
  });

  it("archive() cannot archive another merchant's variant", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });

    repo.archive(ctxB, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBeNull();
  });

  it("archive() sets archivedAt for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });
    repo.archive(ctxA, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("update() can change priceMinor for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      listingId: listingA,
      mode: "PRODUCT",
      sku: "A-SKU",
      name: "A Variant",
      priceMinor: 100,
      currency: "USD",
    });
    repo.update(ctxA, id, { priceMinor: 500 });

    expect(repo.findById(ctxA, id)?.priceMinor).toBe(500);
  });

  it("rejects a variant carrying a field forbidden by its mode — DB CHECK enforced", () => {
    const ctxA = createTenantContext(merchantA);

    expect(() =>
      repo.create(ctxA, {
        listingId: listingA,
        mode: "PRODUCT",
        sku: "A-SKU",
        name: "A Variant",
        priceMinor: 100,
        currency: "USD",
        durationMinutes: 30,
      }),
    ).toThrow();
  });
});
