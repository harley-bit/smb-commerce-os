import { buildDepositDisclosure, type DepositDisclosure, type TenantContext } from "@smb-os/domain";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { DepositConsentRepository } from "../repositories/DepositConsentRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";

export interface AcknowledgeDepositInput {
  orderId: string;
  orderLineId: string;
  customerUserId: string;
  acknowledgedAt: string;
  ip?: string;
  userAgent?: string;
}

export interface DepositConsentResult extends DepositDisclosure {
  id: string;
  orderId: string;
  orderLineId: string;
  customerUserId: string;
  acknowledgedAt: string;
}

/** Thrown when the order the customer is trying to check out doesn't exist under the acting tenant. */
export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

/** Thrown when the acting customer does not own the order — prevents one customer consenting on another's cart. */
export class NotOrderOwnerError extends Error {
  constructor(orderId: string) {
    super(`Customer does not own order: ${orderId}`);
    this.name = "NotOrderOwnerError";
  }
}

/** Thrown when the order is no longer in `CART`/`PENDING_PAYMENT` — deposit consent only applies pre-checkout. */
export class OrderNotCheckoutableError extends Error {
  constructor(orderId: string, status: string) {
    super(`Cannot acknowledge deposit for order ${orderId}: status is ${status}`);
    this.name = "OrderNotCheckoutableError";
  }
}

/** Thrown when the order line does not exist, or does not belong to the order in the request. */
export class OrderLineNotFoundError extends Error {
  constructor(orderLineId: string) {
    super(`Order line not found on this order: ${orderLineId}`);
    this.name = "OrderLineNotFoundError";
  }
}

/**
 * `docs/cards/D129.md` — "Checkout: deposit consent". Companion to D128's
 * `CheckoutDetailsService`, but for `docs/design/07`'s other checkout-time
 * repudiation mitigation: "Customer denies agreeing to deposit terms" —
 * "Explicit consent captured at checkout with version of terms and
 * timestamp." A rental order line's deposit is disclosed to the terms it
 * describes (hold amount, duration, conditions — this card's acceptance
 * criterion) via `@smb-os/domain`'s `buildDepositDisclosure`, computed
 * exclusively from the order line's own server-recorded `depositMinor`/
 * `startsAt`/`endsAt` and the order's own `currency` — never from client
 * input, so what a customer consents to can never be spoofed.
 *
 * This card's security check ("clear disclosure reduces dispute and
 * chargeback risk"): a customer who was shown the exact hold amount,
 * duration, and capture/release conditions before consenting has a much
 * weaker basis to dispute a later capture as an unauthorized or surprise
 * charge — and if they do, `deposit_consents` plus its `audit_log` mirror
 * (same hash-chained, tamper-evident mechanism `CheckoutDetailsService`
 * uses for terms consent) is the merchant's evidence of exactly what was
 * disclosed and when.
 */
export class CheckoutDepositConsentService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly consents: DepositConsentRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  acknowledgeDeposit(ctx: TenantContext, input: AcknowledgeDepositInput): DepositConsentResult {
    const order = this.orderRepo.findById(ctx, input.orderId);
    if (!order) {
      throw new OrderNotFoundError(input.orderId);
    }
    if (order.customerUserId !== input.customerUserId) {
      throw new NotOrderOwnerError(input.orderId);
    }
    if (order.status !== "CART" && order.status !== "PENDING_PAYMENT") {
      throw new OrderNotCheckoutableError(input.orderId, order.status);
    }

    const orderLine = this.orderRepo.findLineById(ctx, input.orderLineId);
    if (!orderLine || orderLine.orderId !== input.orderId) {
      throw new OrderLineNotFoundError(input.orderLineId);
    }

    const disclosure = buildDepositDisclosure({
      depositMinor: orderLine.depositMinor ?? 0,
      currency: order.currency,
      startsAt: orderLine.startsAt ?? "",
      endsAt: orderLine.endsAt ?? "",
    });

    const consentId = this.consents.record(ctx, {
      orderId: input.orderId,
      orderLineId: input.orderLineId,
      customerUserId: input.customerUserId,
      holdAmountMinor: disclosure.holdAmountMinor,
      currency: disclosure.currency,
      holdDurationDays: disclosure.holdDurationDays,
      acknowledgedAt: input.acknowledgedAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    this.auditLog.append(ctx, {
      actorType: "USER",
      actorId: input.customerUserId,
      action: "checkout.deposit_consent_recorded",
      entityType: "order_line",
      entityId: input.orderLineId,
      afterJson: JSON.stringify({
        holdAmountMinor: disclosure.holdAmountMinor,
        currency: disclosure.currency,
        holdDurationDays: disclosure.holdDurationDays,
        acknowledgedAt: input.acknowledgedAt,
      }),
      ip: input.ip,
      userAgent: input.userAgent,
      occurredAt: input.acknowledgedAt,
    });

    return {
      id: consentId,
      orderId: input.orderId,
      orderLineId: input.orderLineId,
      customerUserId: input.customerUserId,
      acknowledgedAt: input.acknowledgedAt,
      ...disclosure,
    };
  }
}
