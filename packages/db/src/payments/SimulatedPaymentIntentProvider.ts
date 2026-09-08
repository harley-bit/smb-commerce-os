import { randomUUID } from "node:crypto";
import type { CreatePaymentIntentInput, PaymentIntentProvider, PaymentIntentResult } from "@smb-os/domain";

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
 */
export class SimulatedPaymentIntentProvider implements PaymentIntentProvider {
  private readonly intents = new Map<string, PaymentIntentResult>();
  private readonly byIdempotencyKey = new Map<string, PaymentIntentResult>();

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
    const result: PaymentIntentResult = {
      intentId,
      clientSecret: `${intentId}_secret_${randomUUID()}`,
      status: "REQUIRES_PAYMENT_METHOD",
      amountMinor: input.amountMinor,
      currency: input.currency,
      connectedAccountId: input.connectedAccountId,
      applicationFeeAmountMinor: input.applicationFeeAmountMinor,
    };
    this.intents.set(intentId, result);
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    return result;
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
