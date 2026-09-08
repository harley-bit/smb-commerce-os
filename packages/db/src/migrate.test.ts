import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection } from "./connection.js";
import { createPgConnection } from "./pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "./migrate.js";

describe("runSqliteMigrations", () => {
  it("applies the real migration chain to a fresh SQLite database", async () => {
    const connection = createConnection(":memory:");

    await runSqliteMigrations(connection);

    const row = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_smoke_test'",
      )
      .get();
    expect(row).toBeDefined();
  });

  it("is forward-only — running it twice does not error or duplicate tables", async () => {
    const connection = createConnection(":memory:");

    await runSqliteMigrations(connection);
    await runSqliteMigrations(connection);

    const rows = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_smoke_test'",
      )
      .all();
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "runPgMigrations (real PostgreSQL)",
  () => {
    it("applies the real migration chain to a fresh PostgreSQL database", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query(
          'DROP TABLE IF EXISTS "locations", "merchant_users", "users", "merchants", "migration_smoke_test" CASCADE',
        );
        // drizzle-orm/node-postgres's migrator tracks applied migrations in
        // a "drizzle"."__drizzle_migrations" table, not the public schema —
        // dropping the whole schema is what actually resets migration state
        // between test runs.
        await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

        await runPgMigrations(connection);

        const result = await connection.pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_name = 'migration_smoke_test'",
        );
        expect(result.rows).toHaveLength(1);
      } finally {
        await connection.pool.end();
      }
    });

    it("fails to apply a PG-incompatible migration — SQLite's AUTOINCREMENT has no PostgreSQL equivalent", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);
      const badMigrationsFolder = mkdtempSync(
        join(tmpdir(), "bad-pg-migration-"),
      );
      mkdirSync(join(badMigrationsFolder, "meta"), { recursive: true });
      writeFileSync(
        join(badMigrationsFolder, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            {
              idx: 0,
              version: "7",
              when: Date.now(),
              tag: "0000_bad",
              breakpoints: true,
            },
          ],
        }),
      );
      writeFileSync(
        join(badMigrationsFolder, "0000_bad.sql"),
        "CREATE TABLE sqlite_only_table (id INTEGER PRIMARY KEY AUTOINCREMENT);",
      );

      const { migrate } = await import("drizzle-orm/node-postgres/migrator");

      try {
        await expect(
          migrate(connection.db, { migrationsFolder: badMigrationsFolder }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
        rmSync(badMigrationsFolder, { recursive: true, force: true });
      }
    });
  },
);
