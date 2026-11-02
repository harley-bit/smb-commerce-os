/**
 * `docs/cards/D129.md` — "Checkout: deposit consent". Pure domain math, no
 * I/O — same shape as `depositDashboard.ts`. `docs/design/07`'s repudiation
 * mitigation for "Customer denies agreeing to deposit terms" is "explicit
 * consent captured at checkout with version of terms and timestamp"; before
 * that consent can mean anything, the customer has to actually see what
 * they're agreeing to. `buildDepositDisclosure` computes the three things
 * this card's acceptance criterion requires be shown — hold amount,
 * duration, and conditions — entirely from the order line's own
 * server-recorded fields (`depositMinor`, `startsAt`/`endsAt`) and the
 * order's own `currency`, never from client input, so the disclosure a
 * customer consents to can never be spoofed to say something other than
 * what will actually happen to their card.
 */

export const DEPOSIT_HOLD_CONDITIONS: readonly string[] = [
  "This is a hold on your card, not a charge — funds are not moved unless the deposit is captured.",
  "The hold is released automatically if the rental is returned on time and in the agreed condition.",
  "The hold may be partially or fully captured to cover damage, loss, or late-return fees, up to the disclosed amount.",
  "The hold expires automatically after the disclosed duration if it is never captured or released.",
];

export interface DepositDisclosureInput {
  readonly depositMinor: number;
  readonly currency: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface DepositDisclosure {
  readonly holdAmountMinor: number;
  readonly currency: string;
  readonly holdDurationDays: number;
  readonly conditions: readonly string[];
}

/** Thrown when a disclosure is requested for a line with no deposit to disclose. */
export class NoDepositToDiscloseError extends Error {
  constructor() {
    super("This order line has no deposit to disclose.");
    this.name = "NoDepositToDiscloseError";
  }
}

/** Thrown when the line's rental interval is missing or non-positive — duration cannot be disclosed. */
export class InvalidDepositHoldIntervalError extends Error {
  constructor() {
    super("This order line's rental interval is missing or invalid — cannot compute hold duration.");
    this.name = "InvalidDepositHoldIntervalError";
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildDepositDisclosure(input: DepositDisclosureInput): DepositDisclosure {
  if (!input.depositMinor || input.depositMinor <= 0) {
    throw new NoDepositToDiscloseError();
  }

  const startMs = new Date(input.startsAt).getTime();
  const endMs = new Date(input.endsAt).getTime();
  if (!input.startsAt || !input.endsAt || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new InvalidDepositHoldIntervalError();
  }

  const holdDurationDays = Math.ceil((endMs - startMs) / MS_PER_DAY);

  return {
    holdAmountMinor: input.depositMinor,
    currency: input.currency,
    holdDurationDays,
    conditions: DEPOSIT_HOLD_CONDITIONS,
  };
}
