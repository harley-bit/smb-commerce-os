import { buildOrderReceipt, type OrderReceipt, type TenantContext } from "@smb-os/domain";
import type { OrderRepository } from "../repositories/OrderRepository.js";

export interface ConfirmOrderInput {
  readonly orderId: string;
  readonly confirmedAt: string;
}

/** Thrown when the order the customer is confirming doesn't exist under the acting tenant. */
export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export interface ReceiptEmailInput {
  readonly orderId: string;
  readonly contactEmail: string;
  readonly receipt: OrderReceipt;
}

/**
 * `docs/cards/D131.md` deliverable — "emailed receipt". Same optional,
 * default-no-op injected-callback shape as every other notifier in this
 * codebase (D069, D076, D094, D120): this service has no opinion on the
 * actual delivery channel, it just guarantees the callback fires once per
 * confirmation with the same receipt the confirmation page itself renders.
 */
export type ReceiptEmailNotifier = (input: ReceiptEmailInput) => void;

/**
 * `docs/cards/D131.md` — "Order confirmation". Builds the itemized receipt
 * (`@smb-os/domain`'s `buildOrderReceipt`, this card's acceptance criterion:
 * "receipt itemizes charges and any deposit hold") entirely from the
 * order's own server-recomputed totals and each line's own server-recorded
 * fields via `OrderRepository`, never from client input, and fires the
 * receipt-email notifier when the order has a contact email on file
 * (`CheckoutDetailsService`, D128).
 *
 * This card's security check ("no card details in the receipt"):
 * `OrderRepository`'s `Order`/`OrderLine` shapes carry catalog and money
 * fields only — no card number, CVC, or expiry has ever been read or
 * stored anywhere in this codebase (`docs/design/07`'s "card data never
 * touches our servers", enforced structurally since D089's
 * `CheckoutPaymentService` never accepted one either) — so there is no
 * field this service could read into the receipt even by mistake.
 *
 * Mirrors `CheckoutPaymentService`'s current posture: no `customerUserId`
 * ownership check, since no storefront customer session exists yet for
 * this route either (an open gap already carried by every Phase 7 checkout
 * service before this one).
 */
export class OrderConfirmationService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly notifyReceiptEmail: ReceiptEmailNotifier = () => undefined,
  ) {}

  confirmOrder(ctx: TenantContext, input: ConfirmOrderInput): OrderReceipt {
    const order = this.orderRepo.findById(ctx, input.orderId);
    if (!order) {
      throw new OrderNotFoundError(input.orderId);
    }

    const lines = this.orderRepo.listLines(ctx, input.orderId);
    const receipt = buildOrderReceipt(order, lines);

    if (order.contactEmail) {
      this.notifyReceiptEmail({ orderId: order.id, contactEmail: order.contactEmail, receipt });
    }

    return receipt;
  }
}
