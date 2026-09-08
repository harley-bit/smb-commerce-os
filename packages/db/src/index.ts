import { workspaceGraphMarker } from "@smb-os/domain";

export function dbPackageMarker(): string {
  return `@smb-os/db -> ${workspaceGraphMarker()}`;
}

export { createConnection } from "./connection.js";
export { createPgConnection } from "./pg-connection.js";
export { runSqliteMigrations, runPgMigrations } from "./migrate.js";
export { TenantScopedRepository, type RepositoryMethod } from "./tenancy/TenantScopedRepository.js";
