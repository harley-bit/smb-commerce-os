import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingResourceRepository } from "./ListingResourceRepository.js";

describe("ListingResourceRepository", () => {
  let connection: Connection;
  let repo: ListingResourceRepository;
  let merchantA: string;
  let merchantB: string;
  let locationA: string;
  let locationB: string;
  let listingA: string;
  let listingB: string;
  let resourceA: string;
  let resourceB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new ListingResourceRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    locationA = generateUuidV7();
    locationB = generateUuidV7();
    listingA = generateUuidV7();
    listingB = generateUuidV7();
    resourceA = generateUuidV7();
    resourceB = generateUuidV7();

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

    await connection.db.insert(sqliteSchema.locations).values([
      { id: locationA, merchantId: merchantA, name: "A Shop", timezone: "America/Los_Angeles" },
      { id: locationB, merchantId: merchantB, name: "B Shop", timezone: "America/New_York" },
    ]);

    await connection.db.insert(sqliteSchema.listings).values([
      {
        id: listingA,
        merchantId: merchantA,
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
      {
        id: listingB,
        merchantId: merchantB,
        mode: "SERVICE",
        name: "Massage",
        slug: "massage",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);

    await connection.db.insert(sqliteSchema.resources).values([
      { id: resourceA, merchantId: merchantA, locationId: locationA, kind: "STAFF", name: "Jamie", capacity: 1 },
      { id: resourceB, merchantId: merchantB, locationId: locationB, kind: "STAFF", name: "Riley", capacity: 1 },
    ]);
  });

  it("assigns a resource to a listing scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.assign(ctx, { listingId: listingA, resourceId: resourceA, createdAt: "2026-09-08T00:00:00.000Z" });

    const assigned = repo.listByListing(ctx, listingA);
    expect(assigned.map((r) => r.id)).toEqual([id]);
    expect(assigned[0]).toMatchObject({ merchantId: merchantA, listingId: listingA, resourceId: resourceA });
  });

  it("listByListing() only returns the caller's own assignments — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.assign(ctxA, { listingId: listingA, resourceId: resourceA, createdAt: "2026-09-08T00:00:00.000Z" });
    repo.assign(ctxB, { listingId: listingB, resourceId: resourceB, createdAt: "2026-09-08T00:00:00.000Z" });

    expect(repo.listByListing(ctxA, listingA).map((r) => r.resourceId)).toEqual([resourceA]);
    expect(repo.listByListing(ctxB, listingB).map((r) => r.resourceId)).toEqual([resourceB]);
  });

  it("listByListing() called with another merchant's listing id returns nothing — no cross-tenant read", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.assign(ctxB, { listingId: listingB, resourceId: resourceB, createdAt: "2026-09-08T00:00:00.000Z" });

    expect(repo.listByListing(ctxA, listingB)).toEqual([]);
  });

  it("remove() cannot remove another merchant's assignment", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.assign(ctxA, {
      listingId: listingA,
      resourceId: resourceA,
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.remove(ctxB, id);

    expect(repo.listByListing(ctxA, listingA).map((r) => r.id)).toEqual([id]);
  });

  it("remove() deletes the owning merchant's assignment", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.assign(ctxA, {
      listingId: listingA,
      resourceId: resourceA,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.remove(ctxA, id);

    expect(repo.listByListing(ctxA, listingA)).toEqual([]);
  });
});
