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

describe("audit_log table (SQLite)", () => {
  it("applies the audit_log migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual(["audit_log"]);
  });

  it("round-trips a full audit_log row, including the hash chain columns", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await connection.db.insert(sqliteSchema.merchants).values(merchant);

    await connection.db.insert(sqliteSchema.auditLog).values({
      id: "audit-1",
      merchantId: "merchant-1",
      seq: 0,
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "merchant-1:user-2",
      beforeJson: JSON.stringify({ role: "STAFF" }),
      afterJson: JSON.stringify({ role: "ADMIN" }),
      ip: "203.0.113.7",
      userAgent: "test-agent/1.0",
      occurredAt: "2026-09-08T00:00:00.000Z",
      prevHash: "0".repeat(64),
      rowHash: "a".repeat(64),
    });

    const rows = await connection.db.select().from(sqliteSchema.auditLog);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "audit-1",
        action: "ROLE_CHANGED",
        prevHash: "0".repeat(64),
        rowHash: "a".repeat(64),
      }),
    ]);
  });

  it("rejects an audit_log row referencing a non-existent merchant — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    await expect(
      connection.db.insert(sqliteSchema.auditLog).values({
        id: "audit-1",
        merchantId: "does-not-exist",
        seq: 0,
        actorType: "USER",
        actorId: "user-1",
        action: "ROLE_CHANGED",
        entityType: "merchant_users",
        entityId: "merchant-1:user-2",
        occurredAt: "2026-09-08T00:00:00.000Z",
        prevHash: "0".repeat(64),
        rowHash: "a".repeat(64),
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("audit_log table (real PostgreSQL)", () => {
  it("applies the migration and enforces the merchant FK", async () => {
    const connectionString = process.env.DATABASE_URL as string;
    const connection = createPgConnection(connectionString);

    try {
      await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
      await connection.pool.query('CREATE SCHEMA "public"');
      await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

      await runPgMigrations(connection);

      const merchantId = "018e6b3a-9c3e-7000-8000-000000000001";
      await connection.db.insert(pgSchema.merchants).values({
        id: merchantId,
        name: "Acme Rentals",
        slug: "acme-rentals",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
      });

      const auditId = "018e6b3a-9c3e-7000-8000-000000000002";
      await connection.db.insert(pgSchema.auditLog).values({
        id: auditId,
        merchantId,
        seq: 0,
        actorType: "USER",
        actorId: "user-1",
        action: "ROLE_CHANGED",
        entityType: "merchant_users",
        entityId: `${merchantId}:user-2`,
        occurredAt: new Date("2026-09-08T00:00:00.000Z"),
        prevHash: "0".repeat(64),
        rowHash: "a".repeat(64),
      });

      const rows = await connection.db.select().from(pgSchema.auditLog);
      expect(rows).toHaveLength(1);

      await expect(
        connection.db.insert(pgSchema.auditLog).values({
          id: "018e6b3a-9c3e-7000-8000-000000000003",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000fff",
          seq: 0,
          actorType: "USER",
          actorId: "user-1",
          action: "ROLE_CHANGED",
          entityType: "merchant_users",
          entityId: "x",
          occurredAt: new Date("2026-09-08T00:00:00.000Z"),
          prevHash: "0".repeat(64),
          rowHash: "b".repeat(64),
        }),
      ).rejects.toThrow();
    } finally {
      await connection.pool.end();
    }
  });
});
