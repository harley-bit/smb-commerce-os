import { computeApplicationFeeSplit, Money, type PaymentIntentProvider, type TenantContext } from "@smb-os/domain";
import type { OrderRepository } from "../repositories/OrderRepository.js";

export interface CreateCheckoutIntentInput {
  readonly orderId: string;
  readonly connectedAccountId: string;
  readonly takeRateBasisPoints: number;
  /** `docs/cards/D090.md` security check — required, not optional. */
  readonly idempotencyKey: string;
}

/** `docs/cards/D090.md` — same shape as `BookingService`'s error of the same name. */
export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key is required to create a checkout PaymentIntent");
    this.name = "MissingIdempotencyKeyError";
  }
}

export interface CheckoutIntentResult {
  readonly intentId: string;
  readonly clientSecret: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly connectedAccountId: string;
  readonly applicationFeeAmountMinor: number;
  readonly merchantProceedsMinor: number;
}

/**
 * `docs/cards/D089.md` — checkout PaymentIntent creation behind the
 * `PaymentIntentProvider` port (`@smb-os/domain`), so this service never
 * depends on a concrete Stripe SDK. This card's security check (`amounts
 * computed server-side only`): `CreateCheckoutIntentInput` carries no
 * amount field at all, so a conforming caller cannot supply one — but a
 * raw/untyped payload can still carry extra keys past the type system, so
 * `createCheckoutIntent` reads the charge amount exclusively from
 * `OrderRepository.findById`'s `totalMinor`, the same server-recomputed
 * total `CartService` (D0xx) maintains on every cart mutation, never from
 * the input. The application-fee split itself is pure domain math
 * (`computeApplicationFeeSplit`) run against that server total.
 *
 * No merchant -> connected-account mapping is persisted yet (D087/D088's
 * open gap), so `connectedAccountId` is still supplied by the caller
 * rather than looked up here — out of this card's scope.
 */
export class CheckoutPaymentService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly provider: PaymentIntentProvider,
  ) {}

  async createCheckoutIntent(ctx: TenantContext, input: CreateCheckoutIntentInput): Promise<CheckoutIntentResult> {
    if (!input.idempotencyKey) {
      throw new MissingIdempotencyKeyError();
    }

    const order = this.orderRepo.findById(ctx, input.orderId);
    if (!order) {
      throw new Error(`Order not found: ${input.orderId}`);
    }
    if (order.status !== "CART") {
      throw new Error(`Cannot check out order ${input.orderId}: status is ${order.status}, not CART`);
    }
    if (order.totalMinor <= 0) {
      throw new Error(`Cannot check out order ${input.orderId}: total is zero`);
    }

    const orderTotal = Money.of(order.totalMinor, order.currency);
    const split = computeApplicationFeeSplit(orderTotal, input.takeRateBasisPoints);

    const intent = await this.provider.createPaymentIntent({
      orderId: order.id,
      amountMinor: orderTotal.minorUnits,
      currency: orderTotal.currency,
      connectedAccountId: input.connectedAccountId,
      applicationFeeAmountMinor: split.applicationFee.minorUnits,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      intentId: intent.intentId,
      clientSecret: intent.clientSecret,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      connectedAccountId: intent.connectedAccountId,
      applicationFeeAmountMinor: intent.applicationFeeAmountMinor,
      merchantProceedsMinor: split.merchantProceeds.minorUnits,
    };
  }
}
