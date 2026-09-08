import { workspaceGraphMarker } from "@smb-os/domain";

export function dbPackageMarker(): string {
  return `@smb-os/db -> ${workspaceGraphMarker()}`;
}

export { createConnection, type Connection } from "./connection.js";
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
  VariantRepository,
  type Variant,
  type VariantMode,
  type VariantRatePeriod,
  type CreateVariantInput,
  type UpdateVariantInput,
} from "./repositories/VariantRepository.js";
export { VariantService } from "./services/VariantService.js";
export {
  AuditLogRepository,
  type AuditActorType,
  type AuditLogEntry,
  type AppendAuditLogInput,
} from "./repositories/AuditLogRepository.js";
export {
  InventoryMovementRepository,
  type InventoryMovement,
  type InventoryMovementKind,
  type RecordMovementInput,
} from "./repositories/InventoryMovementRepository.js";
export { InventoryService, type ReceiveStockInput } from "./services/InventoryService.js";
export {
  InventoryUnitRepository,
  type InventoryUnit,
  type InventoryUnitTrackingMode,
  type InventoryUnitStatus,
  type CreateInventoryUnitInput,
} from "./repositories/InventoryUnitRepository.js";
export {
  InventoryUnitService,
  InvalidUnitStatusTransitionError,
  type TransitionUnitStatusInput,
} from "./services/InventoryUnitService.js";
export {
  ProductSaleService,
  type SellProductInput,
  type SellProductResult,
} from "./services/ProductSaleService.js";
export {
  OrderRepository,
  type Order,
  type OrderStatus,
  type OrderLine,
  type OrderLineMode,
  type CreateOrderInput,
  type AddOrderLineInput,
  type OrderTotals,
} from "./repositories/OrderRepository.js";
export {
  CartService,
  type CreateCartInput,
  type AddProductLineInput,
  type CartLineResult,
  type CartTotals,
} from "./services/CartService.js";
export {
  AUDIT_LOG_GENESIS_HASH,
  computeRowHash,
  type AuditLogRowForHash,
} from "./audit/hashChain.js";
export {
  verifyAuditChain,
  type AuditChainVerificationResult,
} from "./audit/verifyChain.js";
export {
  ReservationRepository,
  ReservationConflictError,
  type Reservation,
  type ReservationSubjectType,
  type ReservationState,
  type CreateReservationInput,
} from "./repositories/ReservationRepository.js";
