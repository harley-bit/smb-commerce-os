import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { LocationRepository } from "./LocationRepository.js";

describe("LocationRepository", () => {
  let connection: Connection;
  let repo: LocationRepository;
  let merchantA: string;
  let merchantB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new LocationRepository(connection);

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

  it("creates a location scoped to the caller's merchant", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.create(ctx, {
      name: "Main Shop",
      timezone: "America/Los_Angeles",
    });

    const location = repo.findById(ctx, id);
    expect(location).toMatchObject({
      id,
      merchantId: merchantA,
      name: "Main Shop",
    });
  });

  it("list() only returns the caller's own locations — scoping predicate enforced", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxA, { name: "A Shop", timezone: "America/Los_Angeles" });
    repo.create(ctxB, { name: "B Shop", timezone: "America/New_York" });

    expect(repo.list(ctxA).map((l) => l.name)).toEqual(["A Shop"]);
    expect(repo.list(ctxB).map((l) => l.name)).toEqual(["B Shop"]);
  });

  it("findById() returns undefined for another merchant's location id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, { name: "A Shop", timezone: "America/Los_Angeles" });

    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("update() cannot modify another merchant's location", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, { name: "A Shop", timezone: "America/Los_Angeles" });

    repo.update(ctxB, id, { name: "Hijacked" });

    expect(repo.findById(ctxA, id)?.name).toBe("A Shop");
  });

  it("archive() cannot archive another merchant's location", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.create(ctxA, { name: "A Shop", timezone: "America/Los_Angeles" });

    repo.archive(ctxB, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBeNull();
  });

  it("archive() sets archivedAt for the owning merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.create(ctxA, { name: "A Shop", timezone: "America/Los_Angeles" });
    repo.archive(ctxA, id, "2026-09-09T00:00:00.000Z");

    expect(repo.findById(ctxA, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });
});
