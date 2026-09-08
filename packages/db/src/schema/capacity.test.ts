import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { createPgConnection } from "../pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "../migrate.js";
import * as sqliteSchema from "./sqlite.js";
import * as pgSchema from "./pg.js";

const merchant = {
  id: "merchant-1",
  name: "Acme Rentals",
  slug: "acme-rentals",
  status: "ACTIVE" as const,
  defaultCurrency: "USD",
  createdAt: "2026-09-08T00:00:00.000Z",
};

const location = {
  id: "location-1",
  merchantId: "merchant-1",
  name: "Main studio",
  timezone: "UTC",
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.locations).values(location);
}

describe("service capacity tables (SQLite)", () => {
  it("applies the resources/availability_rules/availability_exceptions migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('resources', 'availability_rules', 'availability_exceptions')",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(new Set(tableNames)).toEqual(
      new Set(["resources", "availability_rules", "availability_exceptions"]),
    );
  });

  it("round-trips a resource with a capacity", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.resources).values({
      id: "resource-1",
      merchantId: "merchant-1",
      locationId: "location-1",
      kind: "STAFF",
      name: "Jane the instructor",
      capacity: 1,
    });

    const rows = await connection.db
      .select()
      .from(sqliteSchema.resources);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "resource-1",
        kind: "STAFF",
        name: "Jane the instructor",
        capacity: 1,
      }),
    ]);
  });

  it("rejects a resource referencing a non-existent location — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.resources).values({
        id: "resource-1",
        merchantId: "merchant-1",
        locationId: "does-not-exist",
        kind: "STAFF",
        name: "Jane the instructor",
        capacity: 1,
      }),
    ).rejects.toThrow();
  });

  it("round-trips a recurring weekly availability rule for a resource", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.resources).values({
      id: "resource-1",
      merchantId: "merchant-1",
      locationId: "location-1",
      kind: "STAFF",
      name: "Jane the instructor",
      capacity: 1,
    });

    await connection.db.insert(sqliteSchema.availabilityRules).values({
      id: "rule-1",
      merchantId: "merchant-1",
      resourceId: "resource-1",
      weekday: 1,
      startTime: "09:00",
      endTime: "17:00",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
    });

    const rows = await connection.db
      .select()
      .from(sqliteSchema.availabilityRules);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "rule-1",
        resourceId: "resource-1",
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      }),
    ]);
  });

  it("rejects an availability rule referencing a non-existent resource — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.availabilityRules).values({
        id: "rule-1",
        merchantId: "merchant-1",
        resourceId: "does-not-exist",
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      }),
    ).rejects.toThrow();
  });

  it("round-trips a blackout availability exception for a resource", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.resources).values({
      id: "resource-1",
      merchantId: "merchant-1",
      locationId: "location-1",
      kind: "STAFF",
      name: "Jane the instructor",
      capacity: 1,
    });

    await connection.db.insert(sqliteSchema.availabilityExceptions).values({
      id: "exception-1",
      merchantId: "merchant-1",
      resourceId: "resource-1",
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT",
      note: "Holiday closure",
    });

    const rows = await connection.db
      .select()
      .from(sqliteSchema.availabilityExceptions);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "exception-1",
        resourceId: "resource-1",
        kind: "BLACKOUT",
        note: "Holiday closure",
      }),
    ]);
  });

  it("rejects an availability exception referencing a non-existent resource — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.availabilityExceptions).values({
        id: "exception-1",
        merchantId: "merchant-1",
        resourceId: "does-not-exist",
        startsAt: "2026-12-25T00:00:00.000Z",
        endsAt: "2026-12-26T00:00:00.000Z",
        kind: "BLACKOUT",
        note: "Holiday closure",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "service capacity tables (real PostgreSQL)",
  () => {
    it("applies the migration, round-trips a resource, a rule, and an exception", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query(
          'DROP TABLE IF EXISTS "availability_exceptions", "availability_rules", "resources", "inventory_movements", "inventory_units", "listing_variants", "listings", "locations", "merchant_users", "users", "merchants", "migration_smoke_test" CASCADE',
        );
        await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

        await runPgMigrations(connection);

        await connection.db.insert(pgSchema.merchants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Acme Rentals",
          slug: "acme-rentals",
          status: "ACTIVE",
          defaultCurrency: "USD",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.locations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000002",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Main studio",
          timezone: "UTC",
        });

        await connection.db.insert(pgSchema.resources).values({
          id: "018e6b3a-9c3e-7000-8000-000000000040",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          locationId: "018e6b3a-9c3e-7000-8000-000000000002",
          kind: "STAFF",
          name: "Jane the instructor",
          capacity: 1,
        });

        await connection.db.insert(pgSchema.availabilityRules).values({
          id: "018e6b3a-9c3e-7000-8000-000000000041",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          resourceId: "018e6b3a-9c3e-7000-8000-000000000040",
          weekday: 1,
          startTime: "09:00",
          endTime: "17:00",
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
        });

        await connection.db.insert(pgSchema.availabilityExceptions).values({
          id: "018e6b3a-9c3e-7000-8000-000000000042",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          resourceId: "018e6b3a-9c3e-7000-8000-000000000040",
          startsAt: new Date("2026-12-25T00:00:00.000Z"),
          endsAt: new Date("2026-12-26T00:00:00.000Z"),
          kind: "BLACKOUT",
          note: "Holiday closure",
        });

        const resourceRows = await connection.db
          .select()
          .from(pgSchema.resources);
        expect(resourceRows).toHaveLength(1);

        const ruleRows = await connection.db
          .select()
          .from(pgSchema.availabilityRules);
        expect(ruleRows).toHaveLength(1);

        const exceptionRows = await connection.db
          .select()
          .from(pgSchema.availabilityExceptions);
        expect(exceptionRows).toHaveLength(1);

        await expect(
          connection.db.insert(pgSchema.availabilityRules).values({
            id: "018e6b3a-9c3e-7000-8000-000000000043",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            resourceId: "018e6b3a-9c3e-7000-8000-000000000099",
            weekday: 2,
            startTime: "09:00",
            endTime: "17:00",
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
