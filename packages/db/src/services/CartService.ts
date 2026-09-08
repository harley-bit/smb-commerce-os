import { computeLineTotal, Money, type TenantContext } from "@smb-os/domain";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { VariantRepository } from "../repositories/VariantRepository.js";

export interface CreateCartInput {
  customerUserId: string;
  currency: string;
}

export interface AddProductLineInput {
  cartId: string;
  variantId: string;
  quantity: number;
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
    const cart = this.orderRepo.findById(ctx, input.cartId);
    if (!cart) {
      throw new Error(`Cart not found: ${input.cartId}`);
    }
    if (cart.status !== "CART") {
      throw new Error(`Cannot add a line to order ${input.cartId}: status is ${cart.status}, not CART`);
    }

    const variant = this.variantRepo.findById(ctx, input.variantId);
    if (!variant) {
      throw new Error(`Variant not found: ${input.variantId}`);
    }
    if (variant.mode !== "PRODUCT") {
      throw new Error(`Cannot add variant ${input.variantId} as a product line: mode is ${variant.mode}, not PRODUCT`);
    }

    const unitPrice = Money.of(variant.priceMinor, variant.currency);
    Money.of(0, cart.currency).add(unitPrice); // throws on currency mismatch before anything is written
    const lineTotal = computeLineTotal(unitPrice, input.quantity);

    const lineId = this.orderRepo.addLine(ctx, input.cartId, {
      listingId: variant.listingId,
      variantId: input.variantId,
      mode: "PRODUCT",
      quantity: input.quantity,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
    });

    this.recomputeTotals(ctx, input.cartId, cart.currency);

    return {
      lineId,
      unitPriceMinor: unitPrice.minorUnits,
      lineTotalMinor: lineTotal.minorUnits,
      currency: variant.currency,
    };
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
