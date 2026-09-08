/**
 * `docs/cards/D096.md` — Stripe refund seam, same "callers depend on the
 * interface only" shape as `PaymentIntentProvider.ts` (D089) and
 * `DepositHoldProvider.ts` (D094). A refund is always issued against the
 * original charge's own `providerRef` — never a caller-supplied charge id —
 * and `amountMinor` is always the amount `RefundService` computed from the
 * order line's server-recorded total and the mode's own cancellation
 * policy, never a client-supplied amount (`docs/design/07`'s "prices are
 * never accepted from the client").
 *
 * `idempotencyKey` is required for the same "mobile retries on poor
 * connections" reason as every other money-moving port in this package
 * (`docs/cards/D090.md`): a retried refund request must replay the original
 * refund, not mint a second one.
 */
export type RefundStatus = "SUCCEEDED";

export interface CreateRefundInput {
  readonly chargeProviderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly refundId: string;
  readonly chargeProviderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: RefundStatus;
}

export interface RefundProvider {
  createRefund(input: CreateRefundInput): Promise<RefundResult>;
}
