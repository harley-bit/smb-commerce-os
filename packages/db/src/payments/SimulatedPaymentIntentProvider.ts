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
 */
export class SimulatedPaymentIntentProvider implements PaymentIntentProvider {
  private readonly intents = new Map<string, PaymentIntentResult>();

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
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
    return result;
  }

  /** Test-only: inspect what the provider actually recorded for a given intent. */
  getRecordedIntent(intentId: string): PaymentIntentResult | undefined {
    return this.intents.get(intentId);
  }
}
