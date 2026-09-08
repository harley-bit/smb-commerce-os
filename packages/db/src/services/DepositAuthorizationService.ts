import type { DepositHoldProvider, DepositState, TenantContext } from "@smb-os/domain";
import type { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { PaymentRepository } from "../repositories/PaymentRepository.js";

export interface PlaceDepositHoldInput {
  readonly orderLineId: string;
  readonly connectedAccountId: string;
  readonly idempotencyKey: string;
  readonly authorizedAt: string;
}

export interface PlaceDepositHoldResult {
  readonly depositAuthorizationId: string;
  readonly paymentId: string;
  readonly intentId: string;
  readonly clientSecret: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly expiresAt: string;
}

export interface CaptureDepositHoldInput {
  readonly depositAuthorizationId: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
  readonly capturedAt: string;
}

export interface CaptureDepositHoldResult {
  readonly depositAuthorizationId: string;
  readonly state: DepositState;
  readonly capturedMinor: number;
  readonly releasedRemainderMinor: number;
}

export interface ReleaseDepositHoldInput {
  readonly depositAuthorizationId: string;
  readonly releasedAt: string;
}

/** `docs/cards/D094.md` security check — a hold with no recorded expiry can never be found by the auto-release job. */
export class MissingHoldExpiryError extends Error {
  constructor() {
    super("Deposit hold provider response did not include a mandatory expiresAt");
    this.name = "MissingHoldExpiryError";
  }
}

export class OrderLineHasNoDepositError extends Error {
  constructor(orderLineId: string) {
    super(`Order line ${orderLineId} has no deposit configured`);
    this.name = "OrderLineHasNoDepositError";
  }
}

/**
 * `docs/cards/D094.md` — "Authorization via provider": places a
 * manual-capture deposit hold behind the `DepositHoldProvider` port
 * (`@smb-os/domain`), same seam pattern as `CheckoutPaymentService`
 * (D089). `PlaceDepositHoldInput` carries no amount field at all — the
 * deposit amount is read exclusively from the order line's own
 * server-recorded `depositMinor` (`OrderRepository.findLineById`), never
 * from the caller, mirroring `CheckoutPaymentService`'s "amounts computed
 * server-side only" security check.
 *
 * The card's own security check ("expires_at mandatory — drives the
 * auto-release job") is enforced here, not just typed: a provider response
 * with a falsy `expiresAt` throws `MissingHoldExpiryError` before either
 * the payment or the deposit-authorization row is ever written, so no
 * `deposit_authorizations` row missing a real expiry can reach the
 * database (the column is `NOT NULL` at the schema level, but this guards
 * the same invariant one layer earlier, against an empty-string bypass).
 */
export class DepositAuthorizationService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly depositRepo: DepositAuthorizationRepository,
    private readonly provider: DepositHoldProvider,
  ) {}

  async placeHold(ctx: TenantContext, input: PlaceDepositHoldInput): Promise<PlaceDepositHoldResult> {
    const line = this.orderRepo.findLineById(ctx, input.orderLineId);
    if (!line) {
      throw new Error(`Order line not found: ${input.orderLineId}`);
    }
    if (!line.depositMinor || line.depositMinor <= 0) {
      throw new OrderLineHasNoDepositError(input.orderLineId);
    }

    const order = this.orderRepo.findById(ctx, line.orderId);
    if (!order) {
      throw new Error(`Order not found: ${line.orderId}`);
    }

    const hold = await this.provider.createManualCaptureHold({
      orderLineId: line.id,
      amountMinor: line.depositMinor,
      currency: order.currency,
      connectedAccountId: input.connectedAccountId,
      idempotencyKey: input.idempotencyKey,
    });

    if (!hold.expiresAt) {
      throw new MissingHoldExpiryError();
    }

    const paymentId = this.paymentRepo.create(ctx, {
      orderId: line.orderId,
      provider: "stripe",
      providerRef: hold.intentId,
      kind: "DEPOSIT_HOLD",
      amountMinor: hold.amountMinor,
      currency: hold.currency,
      status: "PENDING",
      createdAt: input.authorizedAt,
    });

    const depositAuthorizationId = this.depositRepo.create(ctx, {
      orderLineId: line.id,
      paymentId,
      amountMinor: hold.amountMinor,
      currency: hold.currency,
      authorizedAt: input.authorizedAt,
      expiresAt: hold.expiresAt,
    });

    return {
      depositAuthorizationId,
      paymentId,
      intentId: hold.intentId,
      clientSecret: hold.clientSecret,
      amountMinor: hold.amountMinor,
      currency: hold.currency,
      expiresAt: hold.expiresAt,
    };
  }

  /**
   * `docs/cards/D095.md` — capture (full or partial). Calls the provider
   * first: `DepositHoldProvider.captureManualCaptureHold` is the
   * provider-layer half of the "single capture enforced at both domain and
   * provider layers" security check, throwing `DepositHoldAlreadyResolvedError`
   * on a repeat attempt before `depositRepo.capture` ever runs, so a second
   * capture cannot leave a domain-layer write behind even though the
   * provider call happens first. `depositRepo.capture` (D078) is the
   * domain-layer half — it re-derives the next state via
   * `applyDepositEvent` rather than trusting the provider's own arithmetic,
   * so `PARTIALLY_CAPTURED` vs `CAPTURED` is still decided from
   * `capturedMinor` against the row's own `amountMinor`.
   */
  async captureHold(ctx: TenantContext, input: CaptureDepositHoldInput): Promise<CaptureDepositHoldResult> {
    const deposit = this.depositRepo.findById(ctx, input.depositAuthorizationId);
    if (!deposit) {
      throw new Error(`Deposit authorization not found: ${input.depositAuthorizationId}`);
    }
    const payment = this.paymentRepo.findById(ctx, deposit.paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${deposit.paymentId}`);
    }

    const result = await this.provider.captureManualCaptureHold({
      intentId: payment.providerRef,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
    });

    const state = this.depositRepo.capture(ctx, deposit.id, result.capturedMinor);
    this.paymentRepo.applyProviderEvent(ctx, payment.id, { status: "SUCCEEDED", occurredAt: input.capturedAt });

    return {
      depositAuthorizationId: deposit.id,
      state,
      capturedMinor: result.capturedMinor,
      releasedRemainderMinor: result.releasedRemainderMinor,
    };
  }

  /** Same provider-first / domain-second ordering as `captureHold`, for a full release. */
  async releaseHold(ctx: TenantContext, input: ReleaseDepositHoldInput): Promise<DepositState> {
    const deposit = this.depositRepo.findById(ctx, input.depositAuthorizationId);
    if (!deposit) {
      throw new Error(`Deposit authorization not found: ${input.depositAuthorizationId}`);
    }
    const payment = this.paymentRepo.findById(ctx, deposit.paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${deposit.paymentId}`);
    }

    await this.provider.releaseManualCaptureHold({ intentId: payment.providerRef });

    return this.depositRepo.release(ctx, deposit.id, input.releasedAt);
  }
}
