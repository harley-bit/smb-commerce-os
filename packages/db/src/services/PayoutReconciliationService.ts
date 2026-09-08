import {
  assertCan,
  reconcilePayout,
  type PayoutProvider,
  type PayoutReconciliationResult,
  type TenantContext,
} from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { PaymentRepository } from "../repositories/PaymentRepository.js";

/**
 * `docs/cards/D097.md` — "Payout reconciliation view": the merchant-facing
 * payout and fee breakdown. Pulls the provider's own payout report (behind
 * `PayoutProvider`, same seam shape as `RefundProvider`/`PaymentIntentProvider`)
 * and, for each transaction it lists, looks up this platform's own recorded
 * amount via `PaymentRepository.findByProviderRef` — already tenant-scoped,
 * so a merchant can never have another merchant's payment rows folded into
 * its own reconciliation (Gate G1). The actual comparison is
 * `@smb-os/domain`'s `reconcilePayout`, pure math kept apart from any
 * repository access.
 *
 * This card's security check ("reconciliation mismatch is an escalation
 * trigger, T3"): whenever `reconcilePayout` reports `hasMismatch`, this
 * service appends a `payout.reconciliation_mismatch` row to the merchant's
 * own append-only audit log (`AuditLogRepository`) before returning — the
 * same hash-chained, tenant-scoped ledger every other sensitive action in
 * this system writes to — so a mismatch is never just a value quietly
 * returned to a caller that might not check it; it is a durable, timestamped
 * record.
 *
 * Gated by `payouts:manage`, the same RBAC action `docs/design/07`'s role
 * table already restricts to `OWNER` alone ("Full merchant control including
 * payouts" vs. `ADMIN`'s "no payout... changes") — payout figures are
 * exactly the kind of merchant financial data that table scopes to the
 * owner only, so this view reuses that action rather than adding a new one.
 */
export class PayoutReconciliationService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async reconcilePayout(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    payoutId: string,
  ): Promise<PayoutReconciliationResult> {
    assertCan({ role: actingRole }, "payouts:manage");

    const record = await this.provider.getPayout(payoutId);

    const ourAmounts = new Map<string, number>();
    for (const txn of record.transactions) {
      const payment = this.paymentRepo.findByProviderRef(ctx, "stripe", txn.providerRef);
      if (payment) {
        ourAmounts.set(txn.providerRef, payment.kind === "REFUND" ? -payment.amountMinor : payment.amountMinor);
      }
    }

    const result = reconcilePayout(record, ourAmounts);

    if (result.hasMismatch) {
      this.auditLogRepo.append(ctx, {
        actorType: "SYSTEM",
        actorId: "payout-reconciliation-service",
        action: "payout.reconciliation_mismatch",
        entityType: "payout",
        entityId: payoutId,
        afterJson: JSON.stringify(result),
        occurredAt: record.arrivalDate,
      });
    }

    return result;
  }
}
