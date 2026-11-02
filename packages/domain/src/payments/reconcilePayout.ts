import type { ProviderPayoutRecord } from "./PayoutProvider.js";

export interface PayoutLineReconciliation {
  readonly providerRef: string;
  /** `null` when the provider reports a transaction this platform has no matching `payments` row for. */
  readonly ourAmountMinor: number | null;
  readonly providerGrossAmountMinor: number;
  readonly feeMinor: number;
  readonly netAmountMinor: number;
  readonly mismatch: boolean;
}

export interface PayoutReconciliationResult {
  readonly payoutId: string;
  readonly currency: string;
  readonly arrivalDate: string;
  readonly lines: readonly PayoutLineReconciliation[];
  readonly grossAmountMinor: number;
  readonly feeAmountMinor: number;
  readonly netAmountMinor: number;
  readonly hasMismatch: boolean;
}

/**
 * `docs/cards/D097.md` — "Payout reconciliation view", the pure comparison
 * at its core. Pure domain math deliberately kept apart from `PaymentRepository`
 * lookups (`PayoutReconciliationService`, `@smb-os/db`) so the reconciliation
 * rule itself — a provider-reported transaction's `grossAmountMinor` must
 * equal what this platform's own `payments` ledger recorded for the same
 * `providerRef` — is testable without a database.
 *
 * `ourAmountsByProviderRef` carries this platform's own recorded amount per
 * `providerRef` (signed: a `CHARGE` positive, a `REFUND` negative — the same
 * sign convention `PayoutTransaction.grossAmountMinor` uses), so the caller
 * decides how to look those up (tenant-scoped repository access, not this
 * function's concern).
 *
 * Per this card's security check (T3, `docs/design/14`'s risk register): a
 * reconciliation mismatch here — either an amount disagreement or a
 * provider transaction with no matching record at all — is an escalation
 * trigger, not a value to silently average away. `hasMismatch` is `true` if
 * *any* line disagrees, and each disagreeing line is preserved individually
 * rather than folded into a single pass/fail total, so the caller (and
 * ultimately the merchant-facing view) can see exactly which transaction is
 * wrong.
 */
export function reconcilePayout(
  record: ProviderPayoutRecord,
  ourAmountsByProviderRef: ReadonlyMap<string, number>,
): PayoutReconciliationResult {
  const lines: PayoutLineReconciliation[] = record.transactions.map((txn) => {
    const ourAmountMinor = ourAmountsByProviderRef.get(txn.providerRef) ?? null;
    const mismatch = ourAmountMinor === null || ourAmountMinor !== txn.grossAmountMinor;
    return {
      providerRef: txn.providerRef,
      ourAmountMinor,
      providerGrossAmountMinor: txn.grossAmountMinor,
      feeMinor: txn.feeMinor,
      netAmountMinor: txn.netAmountMinor,
      mismatch,
    };
  });

  return {
    payoutId: record.payoutId,
    currency: record.currency,
    arrivalDate: record.arrivalDate,
    lines,
    grossAmountMinor: lines.reduce((sum, line) => sum + line.providerGrossAmountMinor, 0),
    feeAmountMinor: lines.reduce((sum, line) => sum + line.feeMinor, 0),
    netAmountMinor: lines.reduce((sum, line) => sum + line.netAmountMinor, 0),
    hasMismatch: lines.some((line) => line.mismatch),
  };
}
