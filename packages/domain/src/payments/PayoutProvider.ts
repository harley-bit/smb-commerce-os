/**
 * `docs/cards/D097.md` — Stripe Connect payout report seam, same "callers
 * depend on the interface only" shape as `PaymentIntentProvider.ts` (D089)
 * and `RefundProvider.ts` (D096). A payout aggregates a connected account's
 * balance transactions — each one traceable back to a `payments.provider_ref`
 * this platform already recorded (a `CHARGE` or `REFUND`) — with the
 * provider's own gross/fee/net breakdown for that transaction. This port
 * exists so `PayoutReconciliationService` never depends on a concrete Stripe
 * SDK, and so the reconciliation math (`reconcilePayout.ts`) can be tested
 * against a report the test controls rather than a live payout.
 */
export interface PayoutTransaction {
  /** Matches a `payments.provider_ref` this platform already recorded for the same charge/refund. */
  readonly providerRef: string;
  /** Signed: positive for a charge, negative for a refund — same sign convention the report and our ledger must agree on. */
  readonly grossAmountMinor: number;
  /** Combined platform application fee + Stripe processing fee for this transaction. Always >= 0. */
  readonly feeMinor: number;
  /** `grossAmountMinor` minus `feeMinor`, signed the same way as `grossAmountMinor`. */
  readonly netAmountMinor: number;
}

export interface ProviderPayoutRecord {
  readonly payoutId: string;
  readonly currency: string;
  readonly arrivalDate: string;
  readonly transactions: readonly PayoutTransaction[];
}

export interface PayoutProvider {
  getPayout(payoutId: string): Promise<ProviderPayoutRecord>;
}
