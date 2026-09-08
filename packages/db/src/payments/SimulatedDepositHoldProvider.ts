import { randomUUID } from "node:crypto";
import {
  recordProviderAuthorizationWindow,
  type CreateDepositHoldInput,
  type DepositHoldProvider,
  type DepositHoldResult,
} from "@smb-os/domain";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `docs/cards/D094.md` — no Stripe platform account has been provisioned
 * for this project yet, same "native/simulated now, real provider later"
 * precedent as `SimulatedPaymentIntentProvider.ts` (D089). Models a
 * standard card-network authorization hold: a real Stripe account's actual
 * window varies by card network/MCC (`docs/design/05`'s C4 rule), so this
 * simulation picks a fixed 7-day window — well inside the 30-day product
 * ceiling `recordProviderAuthorizationWindow` enforces — and derives
 * `expiresAt` from it. `expiresAt` is always present on the result: this
 * provider cannot produce a hold with no recorded expiry.
 */
export class SimulatedDepositHoldProvider implements DepositHoldProvider {
  private readonly holds = new Map<string, DepositHoldResult>();
  private readonly byIdempotencyKey = new Map<string, DepositHoldResult>();

  constructor(
    private readonly nowFn: () => Date = () => new Date(),
    private readonly providerWindowDays = 7,
  ) {}

  async createManualCaptureHold(input: CreateDepositHoldInput): Promise<DepositHoldResult> {
    if (!input.idempotencyKey) {
      throw new Error("Idempotency-Key is required to create a deposit hold");
    }

    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const window = recordProviderAuthorizationWindow(this.providerWindowDays);
    const expiresAt = new Date(this.nowFn().getTime() + window.providerWindowDays * MILLIS_PER_DAY).toISOString();

    const intentId = `pi_${randomUUID()}`;
    const result: DepositHoldResult = {
      intentId,
      clientSecret: `${intentId}_secret_${randomUUID()}`,
      amountMinor: input.amountMinor,
      currency: input.currency,
      expiresAt,
    };
    this.holds.set(intentId, result);
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  /** Test-only: inspect what the provider actually recorded for a given intent. */
  getRecordedHold(intentId: string): DepositHoldResult | undefined {
    return this.holds.get(intentId);
  }
}
