import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AvailabilityRuleRepository } from "./AvailabilityRuleRepository.js";

describe("AvailabilityRuleRepository", () => {
  let connection: Connection;
  let repo: AvailabilityRuleRepository;
  let merchantA: string;
  let merchantB: string;
  let resourceA: string;
  let resourceB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new AvailabilityRuleRepository(connection);

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

  it("creates an availability rule scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      resourceId: resourceA,
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
    });

    const rule = repo.findById(ctx, id);
    expect(rule).toMatchObject({ id, merchantId: merchantA, resourceId: resourceA, weekday: 1 });
  });

  it("listByResource() only returns the caller's own rules — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, { resourceId: resourceA, weekday: 1, startTime: "09:00", endTime: "17:00" });
    repo.create(ctxB, { resourceId: resourceB, weekday: 2, startTime: "10:00", endTime: "18:00" });

    expect(repo.listByResource(ctxA, resourceA).map((r) => r.weekday)).toEqual([1]);
    expect(repo.listByResource(ctxB, resourceB).map((r) => r.weekday)).toEqual([2]);
  });

  it("findById() returns undefined for another merchant's rule id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's rule", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
    });

    repo.update(ctxB, id, { startTime: "00:00" });

    expect(repo.findById(ctxA, id)?.startTime).toBe("09:00");
  });

  it("remove() cannot delete another merchant's rule", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
    });

    repo.remove(ctxB, id);

    expect(repo.findById(ctxA, id)).toBeDefined();
  });

  it("remove() deletes the rule for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      resourceId: resourceA,
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
    });
    repo.remove(ctxA, id);

    expect(repo.findById(ctxA, id)).toBeUndefined();
  });
});
