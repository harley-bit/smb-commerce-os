import {
  assertCan,
  computeCancellationRefund,
  resolveCancellationPolicy,
  type CancellationPolicySet,
  type FulfillmentMode,
  type RefundProvider,
  type TenantContext,
} from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { PaymentRepository } from "../repositories/PaymentRepository.js";

export interface RefundOrderLineInput {
  readonly orderLineId: string;
  /** The moment the cancellation/refund decision is made — drives the per-mode policy's hours-before-start tier. */
  readonly cancelledAt: string;
  readonly idempotencyKey: string;
}

export interface RefundOrderLineResult {
  readonly paymentId: string | null;
  readonly mode: FulfillmentMode;
  readonly refundPercent: number;
  readonly refundAmountMinor: number;
}

/** `docs/cards/D096.md` — a refund can only be issued against an order line with a real, succeeded charge behind it. */
export class NoChargeToRefundError extends Error {
  constructor(orderId: string) {
    super(`No succeeded charge found for order ${orderId} — nothing to refund`);
    this.name = "NoChargeToRefundError";
  }
}

/**
 * `docs/cards/D096.md` — "Refunds per mode": product, service, and rental
 * refund paths, each mode's own policy applied correctly. Reuses `D084`'s
 * `CancellationPolicySet`/`computeCancellationRefund` — the domain math that
 * already keeps the three modes' refund rules structurally separate
 * (`resolveCancellationPolicy` is an exhaustive switch with no default) —
 * rather than inventing a second refund-specific policy shape.
 *
 * The refund amount is always computed here, server-side, from the order
 * line's own `lineTotalMinor` and the mode's policy — `RefundOrderLineInput`
 * carries no amount field a caller could supply instead.
 *
 * This card's security check ("refund authority restricted by role"):
 * every call asserts the new `payments:refund` merchant action
 * (`@smb-os/domain`'s `rbac.ts`), which only `OWNER`/`ADMIN` hold — `STAFF`
 * and `READ_ONLY` cannot move money out of the merchant's account, even
 * though `STAFF` already handles bookings and condition reports.
 */
export class RefundService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly provider: RefundProvider,
    private readonly policySet: CancellationPolicySet,
  ) {}

  async refundOrderLine(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RefundOrderLineInput,
  ): Promise<RefundOrderLineResult> {
    assertCan({ role: actingRole }, "payments:refund");

    const line = this.orderRepo.findLineById(ctx, input.orderLineId);
    if (!line) {
      throw new Error(`Order line not found: ${input.orderLineId}`);
    }
    const order = this.orderRepo.findById(ctx, line.orderId);
    if (!order) {
      throw new Error(`Order not found: ${line.orderId}`);
    }

    const charge = this.paymentRepo
      .listByOrderId(ctx, line.orderId)
      .find((payment) => payment.kind === "CHARGE" && payment.status === "SUCCEEDED");
    if (!charge) {
      throw new NoChargeToRefundError(line.orderId);
    }

    const policy = resolveCancellationPolicy(this.policySet, line.mode);
    const hoursBeforeStart = line.startsAt
      ? (new Date(line.startsAt).getTime() - new Date(input.cancelledAt).getTime()) / (1000 * 60 * 60)
      : 0;
    const outcome = computeCancellationRefund(policy, hoursBeforeStart, line.lineTotalMinor);

    if (outcome.refundAmountMinor <= 0) {
      return { paymentId: null, mode: outcome.mode, refundPercent: outcome.refundPercent, refundAmountMinor: 0 };
    }

    const refund = await this.provider.createRefund({
      chargeProviderRef: charge.providerRef,
      amountMinor: outcome.refundAmountMinor,
      currency: order.currency,
      idempotencyKey: input.idempotencyKey,
    });

    const existingPayment = this.paymentRepo.findByProviderRef(ctx, "stripe", refund.refundId);
    const paymentId = existingPayment
      ? existingPayment.id
      : this.paymentRepo.create(ctx, {
          orderId: line.orderId,
          provider: "stripe",
          providerRef: refund.refundId,
          kind: "REFUND",
          amountMinor: refund.amountMinor,
          currency: refund.currency,
          status: "SUCCEEDED",
          createdAt: input.cancelledAt,
        });

    return {
      paymentId,
      mode: outcome.mode,
      refundPercent: outcome.refundPercent,
      refundAmountMinor: outcome.refundAmountMinor,
    };
  }
}
