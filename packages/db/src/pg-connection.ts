import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

export interface PgConnection {
  db: NodePgDatabase;
  pool: Pool;
}

/**
 * Opens a PostgreSQL connection pool. Foreign keys are enforced by default
 * in PostgreSQL (unlike SQLite — see `createConnection`'s P9 pragma), so no
 * equivalent setup step is needed here; the statement timeout is the one
 * connection-level guard this dialect needs that SQLite's single-writer
 * model doesn't (`docs/design/04`).
 */
export function createPgConnection(connectionString: string): PgConnection {
  const pool = new Pool({
    connectionString,
    statement_timeout: 30_000,
  });

  const db = drizzle(pool);

  return { db, pool };
}
