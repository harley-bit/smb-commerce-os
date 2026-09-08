import { applyDamageClaimEvent, assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import { type DamageClaim, type DamageClaimRepository } from "../repositories/DamageClaimRepository.js";

export interface FileDamageClaimInput {
  orderLineId: string;
  amountMinor: number;
  filedAt: string;
}

/**
 * `docs/cards/D076.md` deliverable — "customer notification". Same
 * optional, default-no-op injected-callback shape as
 * `FutureReservationCancelledNotifier` (`ProductSaleService`, D069) and the
 * native auth provider's password-reset notifier: this service has no
 * opinion on the delivery channel, it just guarantees the callback fires
 * with the claim's new state once `notifyCustomer` succeeds.
 */
export type DamageClaimCustomerNotifier = (claim: DamageClaim) => void;

/**
 * `docs/cards/D076.md` — the service layer around `DamageClaimRepository`
 * (D076). Every method asserts `bookings:manage`, the same permission
 * `ConditionReportService` (D075) uses for the rest of the rental-return
 * flow, since filing/resolving a damage claim is a continuation of the same
 * check-in work a `STAFF` member already does.
 *
 * `notifyCustomer` is this card's security check made operational: it is
 * the only path that moves a claim into `CUSTOMER_NOTIFIED`, and it is the
 * point at which the injected notifier fires — so a claim can never reach
 * the state that makes it visible to a customer without the customer
 * actually being told about it.
 */
export class DamageClaimService {
  constructor(
    private readonly damageClaims: DamageClaimRepository,
    private readonly notifyCustomer_: DamageClaimCustomerNotifier = () => undefined,
  ) {}

  fileClaim(ctx: TenantContext, actingRole: MerchantUserRole, input: FileDamageClaimInput): string {
    assertCan({ role: actingRole }, "bookings:manage");

    const state = applyDamageClaimEvent("DRAFT", { type: "FILE" });
    return this.damageClaims.create(ctx, {
      orderLineId: input.orderLineId,
      amountMinor: input.amountMinor,
      state,
      filedAt: input.filedAt,
    });
  }

  notifyCustomer(ctx: TenantContext, actingRole: MerchantUserRole, claimId: string): void {
    assertCan({ role: actingRole }, "bookings:manage");

    this.damageClaims.notifyCustomer(ctx, claimId);
    const claim = this.mustFind(ctx, claimId);
    this.notifyCustomer_(claim);
  }

  /**
   * No `actingRole`/`assertCan` — this is the customer's own response to a
   * claim filed against them (this card's security check), not a merchant
   * action gated by merchant RBAC.
   */
  disputeClaim(ctx: TenantContext, claimId: string): void {
    this.damageClaims.dispute(ctx, claimId);
  }

  resolveCaptured(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    claimId: string,
    resolvedAt: string,
    resolutionNote: string | null,
  ): void {
    assertCan({ role: actingRole }, "bookings:manage");
    this.damageClaims.resolveCaptured(ctx, claimId, resolvedAt, resolutionNote);
  }

  resolveWaived(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    claimId: string,
    resolvedAt: string,
    resolutionNote: string | null,
  ): void {
    assertCan({ role: actingRole }, "bookings:manage");
    this.damageClaims.resolveWaived(ctx, claimId, resolvedAt, resolutionNote);
  }

  private mustFind(ctx: TenantContext, claimId: string): DamageClaim {
    const claim = this.damageClaims.findById(ctx, claimId);
    if (!claim) {
      throw new Error(`Damage claim vanished immediately after being written: ${claimId}`);
    }
    return claim;
  }
}
