import type { TenantContext } from "@smb-os/domain";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { CheckoutConsent, CheckoutConsentRepository } from "../repositories/CheckoutConsentRepository.js";
import type { ContactDetails, OrderRepository } from "../repositories/OrderRepository.js";

export interface SubmitCheckoutDetailsInput {
  orderId: string;
  customerUserId: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  termsVersion: string;
  consentedAt: string;
  ip?: string;
  userAgent?: string;
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

/** Thrown when the order is no longer in `CART`/`PENDING_PAYMENT` — details/consent only apply pre-checkout. */
export class OrderNotCheckoutableError extends Error {
  constructor(orderId: string, status: string) {
    super(`Cannot submit checkout details for order ${orderId}: status is ${status}`);
    this.name = "OrderNotCheckoutableError";
  }
}

/** Thrown when no `termsVersion` is supplied — an empty string is not evidence of consent. */
export class MissingTermsVersionError extends Error {
  constructor() {
    super("termsVersion is required to record checkout consent");
    this.name = "MissingTermsVersionError";
  }
}

/**
 * `docs/cards/D128.md` — "Checkout: details and consent". Records the
 * customer's contact details on the order (`OrderRepository.
 * updateContactDetails`) and, in the same call, evidence of terms-of-service
 * consent (`CheckoutConsentRepository.record`).
 *
 * This card's security check (`docs/design/07`'s repudiation-defence
 * mitigation, "Explicit consent captured at checkout with version of terms
 * and timestamp"): every consent this service records is written twice —
 * once to `checkout_consents` (queryable, one row per consent event) and
 * once mirrored into the merchant's hash-chained `audit_log`
 * (`AuditLogRepository.append`) with the same `termsVersion`/timestamp in
 * `afterJson`. `checkout_consents` alone would still be a plain row a
 * privileged actor with DB access could quietly edit or delete after the
 * fact; the audit-log mirror is what makes a later "the customer never
 * agreed to this" claim checkable against a chain that would visibly break
 * if the entry were altered — the same mechanism `docs/design/07` already
 * relies on for "merchant denies capturing a deposit".
 */
export class CheckoutDetailsService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly consents: CheckoutConsentRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  submitDetails(ctx: TenantContext, input: SubmitCheckoutDetailsInput): CheckoutConsent {
    if (!input.termsVersion) {
      throw new MissingTermsVersionError();
    }

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

    const contactDetails: ContactDetails = {
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
    };
    this.orderRepo.updateContactDetails(ctx, input.orderId, contactDetails);

    const consentId = this.consents.record(ctx, {
      orderId: input.orderId,
      customerUserId: input.customerUserId,
      termsVersion: input.termsVersion,
      consentedAt: input.consentedAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    this.auditLog.append(ctx, {
      actorType: "USER",
      actorId: input.customerUserId,
      action: "checkout.consent_recorded",
      entityType: "order",
      entityId: input.orderId,
      afterJson: JSON.stringify({ termsVersion: input.termsVersion, consentedAt: input.consentedAt }),
      ip: input.ip,
      userAgent: input.userAgent,
      occurredAt: input.consentedAt,
    });

    return {
      id: consentId,
      merchantId: ctx.merchantId,
      orderId: input.orderId,
      customerUserId: input.customerUserId,
      termsVersion: input.termsVersion,
      consentedAt: input.consentedAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
  }
}
