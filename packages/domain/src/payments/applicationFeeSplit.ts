import { Money } from "../utils/money.js";

export interface ApplicationFeeSplit {
  readonly applicationFee: Money;
  readonly merchantProceeds: Money;
}

/**
 * `docs/cards/D089.md` — Stripe Connect destination charges split a
 * checkout's total between the connected merchant account and the
 * platform's `application_fee_amount` (`docs/design/15`'s "platform take
 * rate"). This is pure domain math: it only ever operates on a
 * server-computed order total (`Money`, never a client-supplied amount —
 * this card's security check) and an explicit basis-point rate the caller
 * supplies, so no commission rate is hardcoded here. Rounding the fee with
 * `Math.round` and deriving merchant proceeds by subtraction (rather than
 * rounding both sides independently) guarantees the two pieces always sum
 * back to the total exactly, with no minor unit lost or gained to rounding.
 */
export function computeApplicationFeeSplit(orderTotal: Money, takeRateBasisPoints: number): ApplicationFeeSplit {
  if (!Number.isInteger(takeRateBasisPoints)) {
    throw new Error(`Take rate must be an integer number of basis points, got ${takeRateBasisPoints}`);
  }
  if (takeRateBasisPoints < 0 || takeRateBasisPoints > 10_000) {
    throw new Error(`Take rate must be between 0 and 10000 basis points, got ${takeRateBasisPoints}`);
  }

  const applicationFeeMinorUnits = Math.round((orderTotal.minorUnits * takeRateBasisPoints) / 10_000);
  const applicationFee = Money.of(applicationFeeMinorUnits, orderTotal.currency);
  const merchantProceeds = orderTotal.subtract(applicationFee);

  return { applicationFee, merchantProceeds };
}
