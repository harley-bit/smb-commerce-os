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
  type UpdateInventoryUnitFields,
} from "./repositories/InventoryUnitRepository.js";
export {
  InventoryUnitService,
  InvalidUnitStatusTransitionError,
  type TransitionUnitStatusInput,
} from "./services/InventoryUnitService.js";
export {
  ProductSaleService,
  UnitCurrentlyRentedError,
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
export { PgReservationRepository } from "./repositories/PgReservationRepository.js";
export {
  sweepExpiredHoldsSqlite,
  sweepExpiredHoldsPg,
  type SweepResult,
  type AbandonmentReporter,
} from "./jobs/HoldExpirySweeper.js";
export {
  releaseCompletedDepositsSqlite,
  releaseCompletedDepositsPg,
  type DepositAutoReleaseResult,
  type DepositReleaseCandidate,
  type DepositReleaseCustomerNotifier,
} from "./jobs/DepositAutoReleaseJob.js";
export {
  detectOverdueReservationsSqlite,
  detectOverdueReservationsPg,
  type OverdueReservation,
  type LateReturnDetectionResult,
  type OverdueReservationNotifier,
  type LateReturnNotifiers,
} from "./jobs/LateReturnDetector.js";
export {
  detectDownstreamConflictsSqlite,
  detectDownstreamConflictsPg,
  type DownstreamConflictAlert,
  type DownstreamConflictDetectionResult,
  type DownstreamConflictAlertHandler,
  type DownstreamConflictNotifiers,
} from "./jobs/DownstreamConflictAlerts.js";
export {
  ResourceRepository,
  type Resource,
  type ResourceKind,
  type CreateResourceInput,
  type UpdateResourceInput,
} from "./repositories/ResourceRepository.js";
export {
  ListingResourceRepository,
  type ListingResourceAssignment,
  type AssignListingResourceInput,
} from "./repositories/ListingResourceRepository.js";
export {
  AvailabilityRuleRepository,
  type AvailabilityRule,
  type CreateAvailabilityRuleInput,
  type UpdateAvailabilityRuleInput,
} from "./repositories/AvailabilityRuleRepository.js";
export {
  AvailabilityExceptionRepository,
  type AvailabilityException,
  type AvailabilityExceptionKind,
  type CreateAvailabilityExceptionInput,
  type UpdateAvailabilityExceptionInput,
} from "./repositories/AvailabilityExceptionRepository.js";
export { ResourceService, CrossTenantResourceAssignmentError } from "./services/ResourceService.js";
export { AvailabilityCache } from "./cache/AvailabilityCache.js";
export {
  AvailabilityService,
  AvailabilityRangeTooLargeError,
  ResourceNotFoundError,
} from "./services/AvailabilityService.js";
export {
  BookingService,
  DEFAULT_HOLD_CAPS,
  HoldLimitExceededError,
  MissingIdempotencyKeyError,
  type CreateServiceBookingInput,
  type HoldCapConfig,
} from "./services/BookingService.js";
export {
  RentalReservationService,
  MissingIdempotencyKeyError as RentalMissingIdempotencyKeyError,
  VariantNotRentalError,
  type CreateRentalReservationInput,
} from "./services/RentalReservationService.js";
export {
  FulfillmentEventRepository,
  type FulfillmentEvent,
  type FulfillmentEventKind,
  type RecordFulfillmentEventInput,
} from "./repositories/FulfillmentEventRepository.js";
export {
  FulfillmentEventService,
  OrderLineNotFoundError,
  MissingFulfillmentNoteError,
  MissingCheckoutConditionReportError,
  type RecordFulfillmentEventArgs,
} from "./services/FulfillmentEventService.js";
export {
  ConditionReportRepository,
  type ConditionReport,
  type ConditionReportPhase,
  type CreateConditionReportInput,
} from "./repositories/ConditionReportRepository.js";
export {
  ConditionMediaUploadService,
  ConditionReportNotFoundError,
  UnsupportedMediaTypeError,
  MediaTooLargeError,
  ALLOWED_CONDITION_MEDIA_CONTENT_TYPES,
  MAX_CONDITION_MEDIA_BYTES,
  type RequestConditionMediaUploadInput,
  type ConditionMediaUploadGrant,
} from "./services/ConditionMediaUploadService.js";
export { HmacMediaUploadProvider, type HmacMediaUploadProviderConfig } from "./media/HmacMediaUploadProvider.js";
export { SimulatedConnectAccountProvider } from "./payments/SimulatedConnectAccountProvider.js";
export {
  ConnectOnboardingService,
  type StartOnboardingInput,
  type StartOnboardingResult,
  type ConnectAccountStatusResult,
} from "./services/ConnectOnboardingService.js";
export {
  ConditionMediaRepository,
  type ConditionMediaRecord,
  type CreateConditionMediaInput,
} from "./repositories/ConditionMediaRepository.js";
export {
  ConditionMediaConfirmService,
  ConditionMediaHashMismatchError,
  ConditionMediaStorageKeyReusedError,
  type ConfirmConditionMediaUploadInput,
} from "./services/ConditionMediaConfirmService.js";
export {
  ConditionReportService,
  MissingCheckoutBaselineError,
  type RecordCheckinInput,
  type RecordCheckinResult,
} from "./services/ConditionReportService.js";
export {
  runMediaRetentionSqlite,
  runMediaRetentionPg,
  type MediaRetentionCandidate,
  type MediaRetentionRunResult,
  type MediaObjectDeleter,
} from "./jobs/MediaRetentionJob.js";
export {
  PaymentRepository,
  type Payment,
  type PaymentKind,
  type PaymentStatus,
  type CreatePaymentInput,
  type ProviderStatusEvent,
} from "./repositories/PaymentRepository.js";
export { SimulatedPaymentIntentProvider } from "./payments/SimulatedPaymentIntentProvider.js";
export {
  CheckoutPaymentService,
  MissingIdempotencyKeyError as CheckoutMissingIdempotencyKeyError,
  type CreateCheckoutIntentInput,
  type CheckoutIntentResult,
} from "./services/CheckoutPaymentService.js";
export { SimulatedDepositHoldProvider } from "./payments/SimulatedDepositHoldProvider.js";
export {
  DepositAuthorizationRepository,
  type DepositAuthorization,
  type CreateDepositAuthorizationInput,
} from "./repositories/DepositAuthorizationRepository.js";
export {
  DepositAuthorizationService,
  MissingHoldExpiryError,
  OrderLineHasNoDepositError,
  type PlaceDepositHoldInput,
  type PlaceDepositHoldResult,
} from "./services/DepositAuthorizationService.js";
export {
  verifyStripeWebhookSignature,
  type WebhookVerificationOptions,
  type WebhookVerificationResult,
} from "./payments/WebhookSignatureVerifier.js";
export {
  WebhookEventRepository,
  type WebhookEvent,
  type RecordWebhookEventInput,
} from "./repositories/WebhookEventRepository.js";
export { SimulatedRefundProvider } from "./payments/SimulatedRefundProvider.js";
export {
  RefundService,
  NoChargeToRefundError,
  type RefundOrderLineInput,
  type RefundOrderLineResult,
} from "./services/RefundService.js";
