import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AvailabilityExceptionRepository } from "./AvailabilityExceptionRepository.js";

describe("AvailabilityExceptionRepository", () => {
  let connection: Connection;
  let repo: AvailabilityExceptionRepository;
  let merchantA: string;
  let merchantB: string;
  let resourceA: string;
  let resourceB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new AvailabilityExceptionRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    const locationA = generateUuidV7();
    const locationB = generateUuidV7();
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

    await connection.db.insert(sqliteSchema.resources).values([
      {
        id: resourceA,
        merchantId: merchantA,
        locationId: locationA,
        kind: "STAFF",
        name: "Jamie Rivera",
        capacity: 1,
      },
      {
        id: resourceB,
        merchantId: merchantB,
        locationId: locationB,
        kind: "STAFF",
        name: "Alex Chen",
        capacity: 1,
      },
    ]);
  });

  it("creates an availability exception scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });

    const exception = repo.findById(ctx, id);
    expect(exception).toMatchObject({
      id,
      merchantId: merchantA,
      resourceId: resourceA,
      kind: "BLACKOUT",
    });
  });

  it("listByResource() only returns the caller's own exceptions — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });
    repo.create(ctxB, {
      resourceId: resourceB,
      startsAt: "2026-12-31T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      kind: "EXTRA",
    });

    expect(repo.listByResource(ctxA, resourceA).map((e) => e.kind)).toEqual(["BLACKOUT"]);
    expect(repo.listByResource(ctxB, resourceB).map((e) => e.kind)).toEqual(["EXTRA"]);
  });

  it("findById() returns undefined for another merchant's exception id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's exception", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });

    repo.update(ctxB, id, { kind: "EXTRA" });

    expect(repo.findById(ctxA, id)?.kind).toBe("BLACKOUT");
  });

  it("remove() cannot delete another merchant's exception", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });

    repo.remove(ctxB, id);

    expect(repo.findById(ctxA, id)).toBeDefined();
  });

  it("remove() deletes the exception for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
    });
    repo.remove(ctxA, id);

    expect(repo.findById(ctxA, id)).toBeUndefined();
  });
});
