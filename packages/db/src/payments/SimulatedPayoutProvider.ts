import type { PayoutProvider, ProviderPayoutRecord } from "@smb-os/domain";

/**
 * `docs/cards/D097.md` — no Stripe platform account has been provisioned
 * for this project yet, same "native/simulated now, real provider later"
 * precedent as `SimulatedPaymentIntentProvider.ts` (D089) and
 * `SimulatedRefundProvider.ts` (D096). Unlike those providers, a payout
 * report isn't something this platform requests the creation of — Stripe
 * assembles it on its own schedule from balance transactions — so this
 * double is test-seeded (`registerPayout`) rather than built from a
 * `create*` call.
 */
export class SimulatedPayoutProvider implements PayoutProvider {
  private readonly payouts = new Map<string, ProviderPayoutRecord>();

  /** Test-only: seed the report a real webhook/API poll would otherwise deliver. */
  registerPayout(record: ProviderPayoutRecord): void {
    this.payouts.set(record.payoutId, record);
  }

  async getPayout(payoutId: string): Promise<ProviderPayoutRecord> {
    const record = this.payouts.get(payoutId);
    if (!record) {
      throw new Error(`No payout found for payoutId: ${payoutId}`);
    }
    return record;
  }
}
