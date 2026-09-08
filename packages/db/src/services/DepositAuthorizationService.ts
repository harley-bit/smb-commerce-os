import type { DepositHoldProvider, TenantContext } from "@smb-os/domain";
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
}
