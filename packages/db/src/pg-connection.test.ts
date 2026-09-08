import { describe, expect, it } from "vitest";

import { createPgConnection } from "./pg-connection.js";

/**
 * These tests require a real PostgreSQL instance and only run when
 * DATABASE_URL is set — mirroring `docs/design/04`'s CI matrix (the
 * SQLite-only job leaves this unset and skips; the PostgreSQL job in
 * `.github/workflows/ci.yml` sets it against a real service container).
 * Zero-setup local development is preserved: `pnpm test` without
 * DATABASE_URL still runs everything else.
 */
describe.skipIf(!process.env.DATABASE_URL)("createPgConnection", () => {
  const connectionString = process.env.DATABASE_URL as string;

  it("enforces foreign keys by default, unlike SQLite (docs/design/04 P9)", async () => {
    const { pool, db } = createPgConnection(connectionString);
    try {
      await pool.query("DROP TABLE IF EXISTS children");
      await pool.query("DROP TABLE IF EXISTS parents");
      await pool.query("CREATE TABLE parents (id TEXT PRIMARY KEY)");
      await pool.query(
        "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id))",
      );

      await expect(
        pool.query("INSERT INTO children (id, parent_id) VALUES ($1, $2)", [
          "child-1",
          "missing-parent",
        ]),
      ).rejects.toThrow(/violates foreign key constraint/);

      await pool.query("DROP TABLE children");
      await pool.query("DROP TABLE parents");

      expect(() => db.select).not.toThrow();
    } finally {
      await pool.end();
    }
  });

  it("returns a drizzle db handle backed by the same pool", async () => {
    const { pool, db } = createPgConnection(connectionString);
    try {
      await pool.query("CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY)");
      await expect(db.execute("SELECT * FROM probe")).resolves.not.toThrow();
      await pool.query("DROP TABLE probe");
    } finally {
      await pool.end();
    }
  });

  it("sets a statement timeout so a runaway query cannot hold a connection forever", async () => {
    const { pool } = createPgConnection(connectionString);
    try {
      const result = await pool.query("SHOW statement_timeout");
      expect(result.rows[0].statement_timeout).not.toBe("0");
    } finally {
      await pool.end();
    }
  });
});
