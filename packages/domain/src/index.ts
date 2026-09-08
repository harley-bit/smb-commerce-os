export * from "./auth/AuthProvider.js";
export * from "./auth/rbac.js";
export * from "./media/MediaUploadProvider.js";
export * from "./tenancy/TenantContext.js";
export * from "./utils/uuid.js";
export * from "./utils/money.js";
export * from "./utils/lineTotal.js";
export * from "./utils/time.js";
export * from "./utils/interval.js";
export * from "./utils/availabilityRule.js";
export * from "./utils/availabilityExceptions.js";
export * from "./utils/freeIntervals.js";
export * from "./reservations/reservationStateMachine.js";
export * from "./reservations/bufferExpansion.js";
export * from "./reservations/unitAllocator.js";
export * from "./rentals/conditionGrade.js";
export * from "./rentals/damageClaimStateMachine.js";
export * from "./rentals/lateFeePolicy.js";
export * from "./orders/cancellationPolicy.js";
export * from "./payments/depositStateMachine.js";
export * from "./payments/authorizationWindow.js";
export * from "./payments/ConnectAccountProvider.js";
export * from "./payments/connectAccountStatus.js";
export * from "./media/mediaRetentionPolicy.js";

export function workspaceGraphMarker(): string {
  return "@smb-os/domain";
}

export function isNonEmptyLabel(label: string): boolean {
  if (label.trim().length === 0) {
    return false;
  }
  return true;
}
