import { randomUUID } from "node:crypto";
import type { CreateRefundInput, RefundProvider, RefundResult } from "@smb-os/domain";

/**
 * `docs/cards/D096.md` — no Stripe platform account has been provisioned
 * for this project yet, same "native/simulated now, real provider later"
 * precedent as `SimulatedPaymentIntentProvider.ts` (D089) and
 * `SimulatedDepositHoldProvider.ts` (D094). Models Stripe's own
 * idempotency-key behavior: a `createRefund` call replaying an
 * already-seen `idempotencyKey` returns the original `RefundResult`
 * unchanged rather than minting a second refund.
 */
export class SimulatedRefundProvider implements RefundProvider {
  private readonly refunds = new Map<string, RefundResult>();
  private readonly byIdempotencyKey = new Map<string, RefundResult>();

  async createRefund(input: CreateRefundInput): Promise<RefundResult> {
    if (!input.idempotencyKey) {
      throw new Error("Idempotency-Key is required to create a refund");
    }
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error(`Refund amount must be a positive integer, got ${input.amountMinor}`);
    }

    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const refundId = `re_${randomUUID()}`;
    const result: RefundResult = {
      refundId,
      chargeProviderRef: input.chargeProviderRef,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "SUCCEEDED",
    };
    this.refunds.set(refundId, result);
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  /** Test-only: how many distinct refunds have actually been minted. */
  refundCount(): number {
    return this.refunds.size;
  }
}
