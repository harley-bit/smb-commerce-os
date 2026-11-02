import { Money } from "./money.js";

/**
 * Invariant I8 (docs/design/03): an order line's total always equals
 * quantity x unit price, in minor units. `Money.multiply` already refuses a
 * non-integer factor, so the product is guaranteed to stay integer minor
 * units end to end — no floating point enters a money path.
 */
export function computeLineTotal(unitPrice: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new Error(`Line total quantity must be an integer, got ${quantity}`);
  }
  if (quantity <= 0) {
    throw new Error(`Line total quantity must be positive, got ${quantity}`);
  }
  return unitPrice.multiply(quantity);
}

/**
 * Asserts invariant I8 against a caller-supplied line total, per
 * docs/design/03's "asserted on write" note — a write path should call this
 * rather than trusting a client-computed total.
 */
export function assertLineTotal(
  unitPrice: Money,
  quantity: number,
  claimedLineTotal: Money,
): void {
  const expected = computeLineTotal(unitPrice, quantity);
  if (!expected.equals(claimedLineTotal)) {
    throw new Error(
      `Invariant I8 violated: line total ${claimedLineTotal.minorUnits} ${claimedLineTotal.currency} ` +
        `does not equal quantity (${quantity}) x unit price (${expected.minorUnits} ${expected.currency})`,
    );
  }
}
