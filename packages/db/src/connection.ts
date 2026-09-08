import Database, { type Database as DatabaseHandle } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export interface Connection {
  db: BetterSQLite3Database;
  sqlite: DatabaseHandle;
}

/**
 * Opens a SQLite connection with the pragmas `docs/design/04` requires on
 * every connection, not just at schema-creation time — `foreign_keys` in
 * particular resets to off on every new connection, so it must be set here
 * rather than relied on from a prior session.
 */
export function createConnection(filename: string): Connection {
  const sqlite = new Database(filename);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite);

  return { db, sqlite };
}
