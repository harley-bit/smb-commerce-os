import { workspaceGraphMarker } from "@smb-os/domain";

export function dbPackageMarker(): string {
  return `@smb-os/db -> ${workspaceGraphMarker()}`;
}

export { createConnection } from "./connection.js";
export { createPgConnection } from "./pg-connection.js";
export { runSqliteMigrations, runPgMigrations } from "./migrate.js";
export { TenantScopedRepository, type RepositoryMethod } from "./tenancy/TenantScopedRepository.js";
export {
  listTenantScopedMethods,
  findIsolationCoverageGaps,
  type RepositoryMethodRef,
  type IsolationCoverageGap,
} from "./tenancy/isolation-coverage.js";
export {
  MerchantRepository,
  type Merchant,
  type CreateMerchantInput,
  type UpdateMerchantInput,
} from "./repositories/MerchantRepository.js";
export {
  LocationRepository,
  type Location,
  type CreateLocationInput,
  type UpdateLocationInput,
} from "./repositories/LocationRepository.js";
export {
  UserRepository,
  type User,
  type CreateUserInput,
} from "./repositories/UserRepository.js";
export {
  MerchantUserRepository,
  type MerchantUser,
  type MerchantUserRole,
} from "./repositories/MerchantUserRepository.js";
export {
  ListingRepository,
  type Listing,
  type ListingMode,
  type ListingStatus,
  type CreateListingInput,
  type UpdateListingInput,
} from "./repositories/ListingRepository.js";
export { ListingService, assertCanManageCatalog } from "./services/ListingService.js";
export {
  ProductListingService,
  type CreateProductListingInput,
} from "./services/ProductListingService.js";
export {
  AuditLogRepository,
  type AuditActorType,
  type AuditLogEntry,
  type AppendAuditLogInput,
} from "./repositories/AuditLogRepository.js";
export {
  AUDIT_LOG_GENESIS_HASH,
  computeRowHash,
  type AuditLogRowForHash,
} from "./audit/hashChain.js";
export {
  verifyAuditChain,
  type AuditChainVerificationResult,
} from "./audit/verifyChain.js";
