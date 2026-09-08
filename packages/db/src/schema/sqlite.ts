import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Smoke-test table only — exercises the migration tooling (drizzle-kit
 * generate + apply, both dialects) before Phase 1's real tenancy schema
 * lands in D018. Not a domain table; do not add domain columns here.
 */
export const migrationSmokeTest = sqliteTable("migration_smoke_test", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});
