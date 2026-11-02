import { computeLineTotal, Money, type TenantContext } from "@smb-os/domain";
import type { Order, OrderRepository } from "../repositories/OrderRepository.js";
import type { Variant, VariantRepository } from "../repositories/VariantRepository.js";

export interface CreateCartInput {
  customerUserId: string;
  currency: string;
}

export interface AddProductLineInput {
  cartId: string;
  variantId: string;
  quantity: number;
}

export interface AddServiceLineInput {
  cartId: string;
  variantId: string;
  startsAt: string;
  endsAt: string;
}

export interface AddRentalLineInput {
  cartId: string;
  variantId: string;
  startsAt: string;
  endsAt: string;
}

export interface CartLineResult {
  lineId: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
}

export interface CartTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
}

/**
 * This card's security check (`docs/design/07`): the cart is
 * server-authoritative. `AddProductLineInput` carries no price field at
 * all, so a conforming caller cannot supply one — but a raw/untyped payload
 * (a real HTTP body) can still carry extra keys past the type system, so
 * `addProductLine` reads price exclusively from `VariantRepository.findById`,
 * the server's own record, and recomputes the cart's `subtotalMinor`/
 * `totalMinor` from `OrderRepository.listLines` on every mutation — never
 * incrementally — so a stale or tampered total can never survive a second
 * line being added. Tax is not yet modeled (Phase 2); `taxMinor` stays 0.
 */
export class CartService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly variantRepo: VariantRepository,
  ) {}

  createCart(ctx: TenantContext, input: CreateCartInput): string {
    return this.orderRepo.create(ctx, {
      customerUserId: input.customerUserId,
      status: "CART",
      currency: input.currency,
    });
  }

  addProductLine(ctx: TenantContext, input: AddProductLineInput): CartLineResult {
    const { variant } = this.resolveCartAndVariant(ctx, input.cartId, input.variantId, "PRODUCT");

    const unitPrice = Money.of(variant.priceMinor, variant.currency);
    const lineTotal = computeLineTotal(unitPrice, input.quantity);

    const lineId = this.orderRepo.addLine(ctx, input.cartId, {
      listingId: variant.listingId,
      variantId: input.variantId,
      mode: "PRODUCT",
      quantity: input.quantity,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
    });

    this.recomputeTotals(ctx, input.cartId, variant.currency);

    return {
      lineId,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      currency: variant.currency,
    };
  }

  /**
   * A service booking is one slot, not a quantity — `quantity` is always 1.
   * `startsAt`/`endsAt` are stored on the line for reference; this card does
   * not wire booking-slot conflict checking into cart mutation (that's
   * `BookingService`'s job, D059) — a cart line here is a price-and-time
   * record, not a reservation.
   */
  addServiceLine(ctx: TenantContext, input: AddServiceLineInput): CartLineResult {
    const { variant } = this.resolveCartAndVariant(ctx, input.cartId, input.variantId, "SERVICE");

    const unitPrice = Money.of(variant.priceMinor, variant.currency);
    const lineTotal = computeLineTotal(unitPrice, 1);

    const lineId = this.orderRepo.addLine(ctx, input.cartId, {
      listingId: variant.listingId,
      variantId: input.variantId,
      mode: "SERVICE",
      quantity: 1,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });

    this.recomputeTotals(ctx, input.cartId, variant.currency);

    return {
      lineId,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      currency: variant.currency,
    };
  }

  /**
   * Mirrors D108's log: nothing in this codebase yet multiplies a rental
   * variant's flat `priceMinor` by the number of rate periods in the
   * requested range, so the line total is the flat rate, same as it's
   * disclosed on `RentalDetailView` (D124) — not new scope for this card.
   * `depositMinor` (server's own record, never client-supplied) rides on
   * the line the same way `DamageClaimView`/`DepositAuthorizationService`
   * already read it from an order line.
   */
  addRentalLine(ctx: TenantContext, input: AddRentalLineInput): CartLineResult {
    const { variant } = this.resolveCartAndVariant(ctx, input.cartId, input.variantId, "RENTAL");

    const unitPrice = Money.of(variant.priceMinor, variant.currency);
    const lineTotal = computeLineTotal(unitPrice, 1);

    const lineId = this.orderRepo.addLine(ctx, input.cartId, {
      listingId: variant.listingId,
      variantId: input.variantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      depositMinor: variant.depositMinor ?? undefined,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });

    this.recomputeTotals(ctx, input.cartId, variant.currency);

    return {
      lineId,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      currency: variant.currency,
    };
  }

  /**
   * Shared read path for every `add*Line` method — resolves the cart and
   * variant under the acting tenant's own scope, rejects a non-CART order,
   * a variant of the wrong mode, and a currency mismatch, all before any
   * write happens. Price is always read from `variant`, never from the
   * caller's input — this card's security check.
   */
  private resolveCartAndVariant(
    ctx: TenantContext,
    cartId: string,
    variantId: string,
    expectedMode: Variant["mode"],
  ): { cart: Order; variant: Variant } {
    const cart = this.orderRepo.findById(ctx, cartId);
    if (!cart) {
      throw new Error(`Cart not found: ${cartId}`);
    }
    if (cart.status !== "CART") {
      throw new Error(`Cannot add a line to order ${cartId}: status is ${cart.status}, not CART`);
    }

    const variant = this.variantRepo.findById(ctx, variantId);
    if (!variant) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    if (variant.mode !== expectedMode) {
      throw new Error(`Cannot add variant ${variantId} as a ${expectedMode.toLowerCase()} line: mode is ${variant.mode}, not ${expectedMode}`);
    }

    Money.of(0, cart.currency).add(Money.of(variant.priceMinor, variant.currency)); // throws on currency mismatch before anything is written

    return { cart, variant };
  }

  private recomputeTotals(ctx: TenantContext, cartId: string, currency: string): CartTotals {
    const lines = this.orderRepo.listLines(ctx, cartId);
    const subtotal = lines.reduce(
      (sum, line) => sum.add(Money.of(line.lineTotalMinor, currency)),
      Money.of(0, currency),
    );
    const tax = Money.of(0, currency);
    const total = subtotal.add(tax);

    this.orderRepo.updateTotals(ctx, cartId, {
      subtotalMinor: subtotal.minorUnits,
      taxMinor: tax.minorUnits,
      totalMinor: total.minorUnits,
    });

    return {
      subtotalMinor: subtotal.minorUnits,
      taxMinor: tax.minorUnits,
      totalMinor: total.minorUnits,
      currency,
    };
  }
}
