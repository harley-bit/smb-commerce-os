import { fileURLToPath } from "node:url";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { Connection } from "./connection.js";
import type { PgConnection } from "./pg-connection.js";

const sqliteMigrationsFolder = fileURLToPath(
  new URL("../migrations/sqlite", import.meta.url),
);
const pgMigrationsFolder = fileURLToPath(
  new URL("../migrations/pg", import.meta.url),
);

/**
 * Applies every SQLite migration in order, once, forward-only —
 * `docs/design/04`: "no down migrations in production; a bad migration is
 * fixed by a new migration."
 */
export async function runSqliteMigrations(
  connection: Connection,
): Promise<void> {
  await migrateSqlite(connection.db, {
    migrationsFolder: sqliteMigrationsFolder,
  });
}

/** The PostgreSQL-dialect twin of `runSqliteMigrations`. */
export async function runPgMigrations(
  connection: PgConnection,
): Promise<void> {
  await migratePg(connection.db, { migrationsFolder: pgMigrationsFolder });
}
