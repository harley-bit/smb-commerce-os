import { randomUUID } from "node:crypto";
import {
  recordProviderAuthorizationWindow,
  DepositHoldAlreadyResolvedError,
  type CaptureDepositHoldInput,
  type CaptureDepositHoldResult,
  type CreateDepositHoldInput,
  type DepositHoldProvider,
  type DepositHoldResult,
  type ReleaseDepositHoldInput,
} from "@smb-os/domain";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

type HoldResolution = "AUTHORIZED" | "CAPTURED" | "RELEASED";

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
  private readonly resolutions = new Map<string, HoldResolution>();
  private readonly byCaptureIdempotencyKey = new Map<string, CaptureDepositHoldResult>();

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
    this.resolutions.set(intentId, "AUTHORIZED");
    return result;
  }

  /**
   * `docs/cards/D095.md` security check (provider-layer half) — refuses to
   * capture an intent this provider has already resolved (captured or
   * released), independent of whatever `deposit_authorizations.state` says.
   * A partial capture (`amountMinor` below the held amount) releases the
   * remainder in the same call, mirroring real Stripe manual-capture
   * behavior.
   */
  async captureManualCaptureHold(input: CaptureDepositHoldInput): Promise<CaptureDepositHoldResult> {
    if (!input.idempotencyKey) {
      throw new Error("Idempotency-Key is required to capture a deposit hold");
    }

    const existing = this.byCaptureIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const hold = this.holds.get(input.intentId);
    if (!hold) {
      throw new Error(`Unknown deposit hold intent: ${input.intentId}`);
    }

    const resolution = this.resolutions.get(input.intentId) ?? "AUTHORIZED";
    if (resolution !== "AUTHORIZED") {
      throw new DepositHoldAlreadyResolvedError(input.intentId, resolution);
    }

    if (input.amountMinor <= 0 || input.amountMinor > hold.amountMinor) {
      throw new Error(
        `Capture amount (${input.amountMinor}) must be positive and cannot exceed the authorized amount (${hold.amountMinor})`,
      );
    }

    this.resolutions.set(input.intentId, "CAPTURED");
    const result: CaptureDepositHoldResult = {
      intentId: input.intentId,
      capturedMinor: input.amountMinor,
      releasedRemainderMinor: hold.amountMinor - input.amountMinor,
    };
    this.byCaptureIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  /** Same `DepositHoldAlreadyResolvedError` guard as `captureManualCaptureHold`. */
  async releaseManualCaptureHold(input: ReleaseDepositHoldInput): Promise<void> {
    const hold = this.holds.get(input.intentId);
    if (!hold) {
      throw new Error(`Unknown deposit hold intent: ${input.intentId}`);
    }

    const resolution = this.resolutions.get(input.intentId) ?? "AUTHORIZED";
    if (resolution !== "AUTHORIZED") {
      throw new DepositHoldAlreadyResolvedError(input.intentId, resolution);
    }

    this.resolutions.set(input.intentId, "RELEASED");
  }

  /** Test-only: inspect what the provider actually recorded for a given intent. */
  getRecordedHold(intentId: string): DepositHoldResult | undefined {
    return this.holds.get(intentId);
  }
}
