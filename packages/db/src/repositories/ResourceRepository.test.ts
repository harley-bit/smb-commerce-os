import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ResourceRepository } from "./ResourceRepository.js";

describe("ResourceRepository", () => {
  let connection: Connection;
  let repo: ResourceRepository;
  let merchantA: string;
  let merchantB: string;
  let locationA: string;
  let locationB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new ResourceRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    locationA = generateUuidV7();
    locationB = generateUuidV7();

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
  });

  it("creates a resource scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      locationId: locationA,
      kind: "STAFF",
      name: "Jamie Rivera",
      capacity: 1,
    });

    const resource = repo.findById(ctx, id);
    expect(resource).toMatchObject({
      id,
      merchantId: merchantA,
      kind: "STAFF",
      name: "Jamie Rivera",
    });
  });

  it("list() only returns the caller's own resources — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, { locationId: locationA, kind: "ROOM", name: "Room A", capacity: 4 });
    repo.create(ctxB, { locationId: locationB, kind: "ROOM", name: "Room B", capacity: 2 });

    expect(repo.list(ctxA).map((r) => r.name)).toEqual(["Room A"]);
    expect(repo.list(ctxB).map((r) => r.name)).toEqual(["Room B"]);
  });

  it("findById() returns undefined for another merchant's resource id — no cross-tenant staff-name leak", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      locationId: locationA,
      kind: "STAFF",
      name: "Jamie Rivera",
      capacity: 1,
    });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's resource", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      locationId: locationA,
      kind: "EQUIPMENT",
      name: "Projector",
      capacity: 1,
    });

    repo.update(ctxB, id, { name: "Hijacked" });

    expect(repo.findById(ctxA, id)?.name).toBe("Projector");
  });

  it("archive() cannot archive another merchant's resource", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, {
      locationId: locationA,
      kind: "EQUIPMENT",
      name: "Projector",
      capacity: 1,
    });

    repo.archive(ctxB, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBeNull();
  });

  it("archive() sets archivedAt for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, {
      locationId: locationA,
      kind: "EQUIPMENT",
      name: "Projector",
      capacity: 1,
    });
    repo.archive(ctxA, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });
});
