import {
  computeCancellationRefund,
  resolveCancellationPolicy,
  type CancellationPolicySet,
  type FulfillmentMode,
  type RefundProvider,
  type TenantContext,
} from "@smb-os/domain";
import type { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { PaymentRepository } from "../repositories/PaymentRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";
import type { DepositAuthorizationService } from "./DepositAuthorizationService.js";

export interface CancelOrderInput {
  readonly cancelledAt: string;
  readonly idempotencyKey: string;
}

export interface CancelledOrderLineResult {
  readonly orderLineId: string;
  readonly mode: FulfillmentMode;
  readonly refundPercent: number;
  readonly refundAmountMinor: number;
  readonly paymentId: string | null;
  readonly depositReleased: boolean;
}

export interface CancelOrderResult {
  readonly orderId: string;
  readonly lines: CancelledOrderLineResult[];
}

/** `docs/cards/D133.md` — cancelling an order that is already terminal (cancelled/refunded) is a no-op that should fail loudly, not silently double-refund. */
export class OrderAlreadyFinalizedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} is already cancelled or refunded`);
    this.name = "OrderAlreadyFinalizedError";
  }
}

/**
 * `docs/cards/D133.md` — "Cancellation flow": per-mode cancellation with
 * policy application. Reuses `D084`'s `CancellationPolicySet` /
 * `computeCancellationRefund` for the refund math (the same domain
 * functions `RefundService`, D096, already applies) and `D094`/`D095`'s
 * `DepositAuthorizationService.releaseHold` for deposit release, rather
 * than inventing a second refund or deposit computation.
 *
 * Unlike `RefundService.refundOrderLine` — which is a merchant-staff action
 * gated by the `payments:refund` role (only OWNER/ADMIN) — cancellation
 * here is a *customer* action gated by ownership, not role: this card's
 * security check. `cancelOrder` re-checks `order.customerUserId` against
 * the caller's own session-derived id and returns `undefined` — the exact
 * same outcome as an order id that doesn't exist — on a mismatch, the same
 * pattern `CustomerOrderHistoryService.getOrderDetail` (D132) established,
 * so a cancellation attempt against another customer's order cannot be
 * distinguished from attempting to cancel an order that was never placed.
 *
 * Every order line is refunded, has its blocking reservation cancelled
 * (if any), and has its deposit hold released (if any) before the order
 * itself is marked `CANCELLED` — a partial cancellation (e.g. a reservation
 * cancelled but its deposit left held) is exactly the kind of drift this
 * card's "correct refund and deposit release per policy" acceptance
 * criterion rules out.
 */
export class CustomerCancellationService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly reservationRepo: ReservationRepository,
    private readonly depositRepo: DepositAuthorizationRepository,
    private readonly depositService: DepositAuthorizationService,
    private readonly refundProvider: RefundProvider,
    private readonly policySet: CancellationPolicySet,
  ) {}

  async cancelOrder(
    ctx: TenantContext,
    customerUserId: string,
    orderId: string,
    input: CancelOrderInput,
  ): Promise<CancelOrderResult | undefined> {
    const order = this.orderRepo.findById(ctx, orderId);
    if (!order || order.customerUserId !== customerUserId) {
      return undefined;
    }
    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
      throw new OrderAlreadyFinalizedError(order.id);
    }

    const lines = this.orderRepo.listLines(ctx, order.id);
    const charge = this.paymentRepo
      .listByOrderId(ctx, order.id)
      .find((payment) => payment.kind === "CHARGE" && payment.status === "SUCCEEDED");

    const results: CancelledOrderLineResult[] = [];
    for (const line of lines) {
      const policy = resolveCancellationPolicy(this.policySet, line.mode);
      const hoursBeforeStart = line.startsAt
        ? (new Date(line.startsAt).getTime() - new Date(input.cancelledAt).getTime()) / (1000 * 60 * 60)
        : 0;
      const outcome = computeCancellationRefund(policy, hoursBeforeStart, line.lineTotalMinor);

      let paymentId: string | null = null;
      if (outcome.refundAmountMinor > 0 && charge) {
        const refund = await this.refundProvider.createRefund({
          chargeProviderRef: charge.providerRef,
          amountMinor: outcome.refundAmountMinor,
          currency: order.currency,
          idempotencyKey: `${input.idempotencyKey}:${line.id}`,
        });

        const existingPayment = this.paymentRepo.findByProviderRef(ctx, "stripe", refund.refundId);
        paymentId = existingPayment
          ? existingPayment.id
          : this.paymentRepo.create(ctx, {
              orderId: order.id,
              provider: "stripe",
              providerRef: refund.refundId,
              kind: "REFUND",
              amountMinor: refund.amountMinor,
              currency: refund.currency,
              status: "SUCCEEDED",
              createdAt: input.cancelledAt,
            });
      }

      const reservation = this.reservationRepo.findByOrderLineId(ctx, line.id);
      if (reservation && (reservation.state === "HELD" || reservation.state === "CONFIRMED")) {
        this.reservationRepo.cancel(ctx, reservation.id, input.cancelledAt);
      }

      let depositReleased = false;
      const deposit = this.depositRepo.findByOrderLineId(ctx, line.id);
      if (deposit && deposit.state === "AUTHORIZED") {
        await this.depositService.releaseHold(ctx, {
          depositAuthorizationId: deposit.id,
          releasedAt: input.cancelledAt,
        });
        depositReleased = true;
      }

      results.push({
        orderLineId: line.id,
        mode: outcome.mode,
        refundPercent: outcome.refundPercent,
        refundAmountMinor: outcome.refundAmountMinor,
        paymentId,
        depositReleased,
      });
    }

    this.orderRepo.cancel(ctx, order.id, input.cancelledAt);

    return { orderId: order.id, lines: results };
  }
}
