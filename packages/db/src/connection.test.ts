import { rmSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createConnection } from "./connection.js";

describe("createConnection", () => {
  it("enables WAL journal mode on a real file-backed database", () => {
    const dbPath = `${process.cwd()}/.tmp-d013-wal-test.sqlite`;
    const { sqlite } = createConnection(dbPath);
    try {
      // :memory: databases cannot use WAL and silently stay in "memory" mode,
      // so this must run against a real file to actually prove WAL is set.
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      sqlite.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          rmSync(`${dbPath}${suffix}`);
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  it("enforces foreign keys — off by default in SQLite, unlike PostgreSQL", () => {
    const { sqlite } = createConnection(":memory:");
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("sets a non-zero busy timeout so concurrent access waits instead of failing immediately", () => {
    const { sqlite } = createConnection(":memory:");
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("actually enforces the foreign key constraint, not just reports the pragma value", () => {
    const { sqlite } = createConnection(":memory:");
    sqlite.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY);
      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES parents(id)
      );
    `);

    expect(() =>
      sqlite
        .prepare("INSERT INTO children (id, parent_id) VALUES (?, ?)")
        .run("child-1", "missing-parent"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("returns a drizzle db handle backed by the same connection", () => {
    const { db, sqlite } = createConnection(":memory:");
    sqlite.exec("CREATE TABLE probe (id TEXT PRIMARY KEY)");

    expect(() => db.run("SELECT * FROM probe")).not.toThrow();
  });
});
