import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Smoke-test table only — the PostgreSQL-dialect twin of
 * `schema/sqlite.ts`, per `docs/design/04`'s "matching pair per dialect"
 * migration rule. Not a domain table; do not add domain columns here.
 */
export const migrationSmokeTest = pgTable("migration_smoke_test", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
