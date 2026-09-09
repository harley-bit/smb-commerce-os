import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUser, MerchantUserRepository, MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";

export interface RoleChangeEvent {
  merchantId: string;
  targetUserId: string;
  previousRole: MerchantUserRole | null;
  newRole: MerchantUserRole;
  changedByUserId: string;
  occurredAt: string;
}

/**
 * `docs/cards/D120.md` security check — "role changes audit-logged and
 * notified to owners". Same optional, default-no-op injected-callback shape
 * as `DamageClaimCustomerNotifier`/`FutureReservationCancelledNotifier`:
 * this service has no opinion on delivery channel, it just guarantees the
 * callback fires once per current OWNER, after the audit entry is durably
 * written.
 */
export type RoleChangeNotifier = (event: RoleChangeEvent, ownerId: string) => void;

/**
 * Wraps `MerchantUserRepository` (D030-era, previously called directly with
 * no audit trail or notification — a gap that repository's own file
 * comment flagged as tracked, not forgotten). `roles:assign` is OWNER-only
 * per `packages/domain`'s RBAC matrix; the repository's own runtime check
 * on the acting role stays in place underneath as defense in depth, the
 * same two-layer pattern `ListingService`/`./listings.ts` already use.
 */
export class MerchantUserService {
  constructor(
    private readonly merchantUsers: MerchantUserRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly notifyOwner: RoleChangeNotifier = () => undefined,
  ) {}

  assignRole(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    actingUserId: string,
    targetUserId: string,
    role: MerchantUserRole,
    occurredAt: string,
  ): void {
    assertCan({ role: actingRole }, "roles:assign");

    const previousRole = this.merchantUsers.findRole(ctx, targetUserId) ?? null;
    this.merchantUsers.assignRole(ctx, actingRole, targetUserId, role, occurredAt);

    this.auditLog.append(ctx, {
      actorType: "USER",
      actorId: actingUserId,
      action: "merchant_user.role_changed",
      entityType: "merchant_user",
      entityId: targetUserId,
      beforeJson: JSON.stringify({ role: previousRole }),
      afterJson: JSON.stringify({ role }),
      occurredAt,
    });

    const event: RoleChangeEvent = {
      merchantId: ctx.merchantId,
      targetUserId,
      previousRole,
      newRole: role,
      changedByUserId: actingUserId,
      occurredAt,
    };
    for (const owner of this.merchantUsers.list(ctx)) {
      if (owner.role === "OWNER") {
        this.notifyOwner(event, owner.userId);
      }
    }
  }

  list(ctx: TenantContext, actingRole: MerchantUserRole): MerchantUser[] {
    assertCan({ role: actingRole }, "roles:assign");
    return this.merchantUsers.list(ctx);
  }
}
