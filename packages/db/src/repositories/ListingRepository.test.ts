import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";

describe("ListingRepository", () => {
  let connection: Connection;
  let repo: ListingRepository;
  let merchantA: string;
  let merchantB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new ListingRepository(connection);

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
  });

  it("creates a listing scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const listing = repo.findById(ctx, id);
    expect(listing).toMatchObject({
      id,
      merchantId: merchantA,
      mode: "PRODUCT",
      name: "Wool Sweater",
    });
  });

  it("list() only returns the caller's own listings — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.create(ctxB, {
      mode: "SERVICE",
      name: "B Service",
      slug: "b-service",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(repo.list(ctxA).map((l) => l.name)).toEqual(["A Product"]);
    expect(repo.list(ctxB).map((l) => l.name)).toEqual(["B Service"]);
  });

  it("findById() returns undefined for another merchant's listing id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's listing", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.update(ctxB, id, { name: "Hijacked" });

    expect(repo.findById(ctxA, id)?.name).toBe("A Product");
  });

  it("archive() cannot archive another merchant's listing", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.archive(ctxB, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBeNull();
  });

  it("archive() sets archivedAt for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.archive(ctxA, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("update() never accepts a mode column at the schema level (UpdateListingInput has no mode field)", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.update(ctxA, id, { name: "Renamed Product" });

    expect(repo.findById(ctxA, id)?.mode).toBe("PRODUCT");
  });
});
