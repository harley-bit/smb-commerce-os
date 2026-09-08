import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { createPgConnection } from "../pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "../migrate.js";
import * as sqliteSchema from "./sqlite.js";
import * as pgSchema from "./pg.js";

describe("tenancy tables (SQLite)", () => {
  it("applies the merchants/users/merchant_users/locations migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('merchants', 'users', 'merchant_users', 'locations')",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(new Set(tableNames)).toEqual(
      new Set(["merchants", "users", "merchant_users", "locations"]),
    );
  });

  it("has no password column on users — auth is delegated", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const columns = connection.sqlite
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).not.toContain("password");
    expect(columns).not.toContain("password_hash");
  });

  it("round-trips a merchant, a user, a merchant_users role row, and a location", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    await connection.db.insert(sqliteSchema.merchants).values({
      id: "merchant-1",
      name: "Acme Rentals",
      slug: "acme-rentals",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.users).values({
      id: "user-1",
      email: "owner@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.merchantUsers).values({
      merchantId: "merchant-1",
      userId: "user-1",
      role: "OWNER",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.locations).values({
      id: "location-1",
      merchantId: "merchant-1",
      name: "Main Shop",
      timezone: "America/Los_Angeles",
    });

    const merchants = await connection.db
      .select()
      .from(sqliteSchema.merchants);
    const merchantUsers = await connection.db
      .select()
      .from(sqliteSchema.merchantUsers);
    const locations = await connection.db
      .select()
      .from(sqliteSchema.locations);

    expect(merchants).toHaveLength(1);
    expect(merchantUsers).toEqual([
      expect.objectContaining({
        merchantId: "merchant-1",
        userId: "user-1",
        role: "OWNER",
      }),
    ]);
    expect(locations).toHaveLength(1);
  });

  it("rejects a merchant_users row referencing a non-existent merchant — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    await connection.db.insert(sqliteSchema.users).values({
      id: "user-1",
      email: "orphan@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.merchantUsers).values({
        merchantId: "does-not-exist",
        userId: "user-1",
        role: "OWNER",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate merchant slug — unique constraint enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    await connection.db.insert(sqliteSchema.merchants).values({
      id: "merchant-1",
      name: "Acme Rentals",
      slug: "acme-rentals",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.merchants).values({
        id: "merchant-2",
        name: "Acme Rentals Duplicate",
        slug: "acme-rentals",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "tenancy tables (real PostgreSQL)",
  () => {
    it("applies the migration and round-trips a merchant/user/merchant_users/location", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query(
          'DROP TABLE IF EXISTS "locations", "merchant_users", "users", "merchants", "migration_smoke_test" CASCADE',
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

        await connection.db.insert(pgSchema.users).values({
          id: "018e6b3a-9c3e-7000-8000-000000000002",
          email: "owner@acme.test",
          status: "ACTIVE",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.merchantUsers).values({
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          userId: "018e6b3a-9c3e-7000-8000-000000000002",
          role: "OWNER",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.locations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000003",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Main Shop",
          timezone: "America/Los_Angeles",
        });

        const merchants = await connection.db
          .select()
          .from(pgSchema.merchants);
        expect(merchants).toHaveLength(1);

        const columns = await connection.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'",
        );
        const columnNames = columns.rows.map(
          (row: { column_name: string }) => row.column_name,
        );
        expect(columnNames).not.toContain("password");
        expect(columnNames).not.toContain("password_hash");
      } finally {
        await connection.pool.end();
      }
    });
  },
);
