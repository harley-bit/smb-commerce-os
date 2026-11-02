/**
 * `docs/cards/D094.md` — Stripe manual-capture ("hold") PaymentIntent seam
 * for rental deposits, same shape as `PaymentIntentProvider.ts` (D089): a
 * real Stripe-backed implementation can swap in later without touching
 * `DepositAuthorizationService` or any other consumer. `amountMinor` is
 * always supplied by the caller from the order line's server-recorded
 * `depositMinor` (`docs/design/07`'s "prices are never accepted from the
 * client") — this port never reads or trusts a client-supplied amount.
 *
 * Unlike `PaymentIntentProvider`, this intent is created for manual capture
 * (authorize now, capture later or not at all) — it models Stripe's
 * `capture_method: "manual"`, which places a hold on the card without
 * moving funds. `expiresAt` on the result is **mandatory**, not optional:
 * it is the provider's own authorization-hold expiry (`docs/design/05`'s
 * 30-day ceiling, `authorizationWindow.ts`), and `DepositAuthorizationService`
 * refuses to persist a hold without it — a deposit with no recorded expiry
 * can never be found by `DepositAutoReleaseJob` (D080) or any future
 * hold-expiry sweeper, so a missing `expiresAt` would silently strand a
 * customer's card hold forever.
 */
export interface CreateDepositHoldInput {
  readonly orderLineId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly connectedAccountId: string;
  readonly idempotencyKey: string;
}

export interface DepositHoldResult {
  readonly intentId: string;
  readonly clientSecret: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Provider's own hold expiry — mandatory. Never computed locally. */
  readonly expiresAt: string;
}

/**
 * `docs/cards/D095.md` — capturing a manual-capture hold. Mirrors Stripe's
 * own manual-capture semantics: capturing for less than the authorized
 * amount ("partial capture") releases the remainder of the hold as part of
 * the same provider call — there is no separate release step for the
 * uncaptured balance, and this port models that by returning
 * `releasedRemainderMinor` rather than leaving the caller to compute it.
 */
export interface CaptureDepositHoldInput {
  readonly intentId: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
}

export interface CaptureDepositHoldResult {
  readonly intentId: string;
  readonly capturedMinor: number;
  /** Authorized amount minus `capturedMinor` — 0 for a full capture. */
  readonly releasedRemainderMinor: number;
}

export interface ReleaseDepositHoldInput {
  readonly intentId: string;
}

export interface DepositHoldProvider {
  createManualCaptureHold(input: CreateDepositHoldInput): Promise<DepositHoldResult>;
  /**
   * Throws `DepositHoldAlreadyResolvedError` if this `intentId` has already
   * been captured or released — the provider-layer half of D095's
   * single-capture security check.
   */
  captureManualCaptureHold(input: CaptureDepositHoldInput): Promise<CaptureDepositHoldResult>;
  /** Same `DepositHoldAlreadyResolvedError` guard as `captureManualCaptureHold`. */
  releaseManualCaptureHold(input: ReleaseDepositHoldInput): Promise<void>;
}
