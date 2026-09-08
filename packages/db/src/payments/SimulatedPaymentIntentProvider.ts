import { randomUUID } from "node:crypto";
import type { CreatePaymentIntentInput, DeclineCode, PaymentIntentProvider, PaymentIntentResult } from "@smb-os/domain";

/**
 * `docs/cards/D089.md` — no Stripe platform account has been provisioned
 * for this project yet, same "native/simulated now, real provider later"
 * precedent as `SimulatedConnectAccountProvider.ts` (D087). Models a
 * Stripe Connect destination charge: the intent is created for the full
 * `amountMinor`, with `applicationFeeAmountMinor` carved out for the
 * platform and the remainder destined for `connectedAccountId` — never
 * holds or transmits any card data itself (`docs/design/07`, "card data
 * never touches our servers").
 *
 * `docs/cards/D090.md` — models Stripe's own idempotency-key behavior: a
 * `createPaymentIntent` call replaying an already-seen `idempotencyKey`
 * returns the original `PaymentIntentResult` unchanged rather than minting a
 * second intent, same "mobile retries on poor connections" rationale as
 * `ReservationRepository.createGuarded` (D059).
 *
 * `docs/cards/D098.md` — no real Stripe account exists to actually decline a
 * card, so `simulateDeclineForOrder`/`clearDeclineForOrder` are test-only
 * seams standing in for "the next attempt against this order comes back
 * declined" (mirrors `SimulatedDepositHoldProvider`'s test-seeding pattern).
 * The decline persists across calls with distinct idempotency keys until
 * explicitly cleared, modeling a customer retrying with the *same* bad card
 * versus switching to a different payment method.
 */
export class SimulatedPaymentIntentProvider implements PaymentIntentProvider {
  private readonly intents = new Map<string, PaymentIntentResult>();
  private readonly byIdempotencyKey = new Map<string, PaymentIntentResult>();
  private readonly declinesByOrderId = new Map<string, DeclineCode>();

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    if (!input.idempotencyKey) {
      throw new Error("Idempotency-Key is required to create a PaymentIntent");
    }

    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    if (input.applicationFeeAmountMinor > input.amountMinor) {
      throw new Error(
        `Application fee (${input.applicationFeeAmountMinor}) cannot exceed the charge amount (${input.amountMinor})`,
      );
    }
    const intentId = `pi_${randomUUID()}`;
    const declineCode = this.declinesByOrderId.get(input.orderId);
    const result: PaymentIntentResult = {
      intentId,
      clientSecret: `${intentId}_secret_${randomUUID()}`,
      status: declineCode ? "DECLINED" : "REQUIRES_PAYMENT_METHOD",
      amountMinor: input.amountMinor,
      currency: input.currency,
      connectedAccountId: input.connectedAccountId,
      applicationFeeAmountMinor: input.applicationFeeAmountMinor,
      ...(declineCode ? { declineCode } : {}),
    };
    this.intents.set(intentId, result);
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  /** Test-only: the next attempt(s) against this order decline with the given reason. */
  simulateDeclineForOrder(orderId: string, declineCode: DeclineCode): void {
    this.declinesByOrderId.set(orderId, declineCode);
  }

  /** Test-only: stop declining this order (models switching to a working payment method). */
  clearDeclineForOrder(orderId: string): void {
    this.declinesByOrderId.delete(orderId);
  }

  /** Test-only: inspect what the provider actually recorded for a given intent. */
  getRecordedIntent(intentId: string): PaymentIntentResult | undefined {
    return this.intents.get(intentId);
  }

  /** Test-only: how many distinct PaymentIntents have actually been minted. */
  intentCount(): number {
    return this.intents.size;
  }
}
