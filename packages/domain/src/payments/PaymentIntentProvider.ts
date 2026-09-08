/**
 * `docs/cards/D089.md` — Stripe Connect destination-charge PaymentIntent
 * seam, same shape as `ConnectAccountProvider.ts` (D087): callers depend on
 * this interface only, so a real Stripe-backed implementation can swap in
 * later without touching `CheckoutPaymentService` or any other consumer.
 * `amountMinor` and `applicationFeeAmountMinor` are always supplied by the
 * caller from server-computed values (`docs/design/07`'s "prices are never
 * accepted from the client") — this port never reads or trusts a
 * client-supplied amount itself.
 */
export type PaymentIntentStatus = "REQUIRES_PAYMENT_METHOD" | "SUCCEEDED";

export interface CreatePaymentIntentInput {
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly connectedAccountId: string;
  readonly applicationFeeAmountMinor: number;
}

export interface PaymentIntentResult {
  readonly intentId: string;
  readonly clientSecret: string;
  readonly status: PaymentIntentStatus;
  readonly amountMinor: number;
  readonly currency: string;
  readonly connectedAccountId: string;
  readonly applicationFeeAmountMinor: number;
}

export interface PaymentIntentProvider {
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
}
