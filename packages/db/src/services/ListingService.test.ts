import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { ListingService } from "./ListingService.js";

describe("ListingService", () => {
  let connection: Connection;
  let service: ListingService;
  let merchantA: string;
  let merchantB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    service = new ListingService(new ListingRepository(connection));

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

  it("OWNER can create a listing", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(service.findById(ctx, id)).toMatchObject({ name: "Wool Sweater" });
  });

  it("ADMIN can create a listing", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "ADMIN", {
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("STAFF cannot create a listing — authorization asserted at the service layer", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "STAFF", {
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("READ_ONLY cannot create a listing", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "READ_ONLY", {
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("STAFF cannot update a listing", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() => service.update(ctx, "STAFF", id, { name: "Renamed" })).toThrow(
      /restricted to OWNER or ADMIN/,
    );
  });

  it("STAFF cannot archive a listing", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() =>
      service.archive(ctx, "STAFF", id, "2026-09-09T00:00:00.000Z"),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("any role can list and read listings", () => {
    const ctx = createTenantContext(merchantA);
    service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(service.list(ctx).map((l) => l.name)).toEqual(["Wool Sweater"]);
  });

  it("attempt to change mode after creation is rejected", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const tamperedPatch = { name: "Retagged", mode: "SERVICE" } as Record<string, unknown>;

    expect(() => service.update(ctx, "OWNER", id, tamperedPatch)).toThrow(/mode is immutable/i);
    expect(service.findById(ctx, id)?.mode).toBe("PRODUCT");
  });

  it("update() without a mode field succeeds normally", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      mode: "PRODUCT",
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    service.update(ctx, "OWNER", id, { name: "Cotton Sweater" });

    expect(service.findById(ctx, id)?.name).toBe("Cotton Sweater");
  });

  it("service methods are cross-tenant isolated via the repository's scope", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = service.create(ctxA, "OWNER", {
      mode: "PRODUCT",
      name: "A Product",
      slug: "a-product",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(service.findById(ctxB, id)).toBeUndefined();
    expect(service.list(ctxB)).toEqual([]);
  });
});
