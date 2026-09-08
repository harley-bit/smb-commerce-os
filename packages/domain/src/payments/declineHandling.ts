/**
 * `docs/cards/D098.md` — payment failure handling. Pure domain mapping from
 * a provider's raw decline reason to a customer-facing outcome. This is the
 * card's security check made structural: `lost_card`/`stolen_card`/
 * `fraud_suspected` must never surface their real reason to the customer
 * (revealing "your card was reported stolen" both tips off an actual card
 * tester and can wrongly accuse/alarm a legitimate cardholder whose card was
 * misflagged) — they collapse onto the exact same generic message as a
 * plain `card_declined`, indistinguishable from the outside.
 *
 * `retryableWithSameMethod` is the "actionable" half of the acceptance
 * criteria: it tells the caller whether it's worth letting the customer
 * retry the identical payment method (a transient processing hiccup, a
 * mistyped CVC) versus steering them to a different one (insufficient
 * funds, an expired card, or any fraud-adjacent decline) without ever
 * naming which case it is.
 */
export type DeclineCode =
  | "insufficient_funds"
  | "expired_card"
  | "incorrect_cvc"
  | "processing_error"
  | "card_declined"
  | "lost_card"
  | "stolen_card"
  | "fraud_suspected";

export interface DeclineOutcome {
  readonly customerMessage: string;
  readonly retryableWithSameMethod: boolean;
}

const GENERIC_DECLINE_MESSAGE =
  "Your card was declined. Please try a different payment method or contact your card issuer.";

export function mapDeclineToCustomerMessage(code: DeclineCode): DeclineOutcome {
  switch (code) {
    case "insufficient_funds":
      return {
        customerMessage:
          "Your card was declined due to insufficient funds. Please try a different payment method.",
        retryableWithSameMethod: false,
      };
    case "expired_card":
      return {
        customerMessage: "Your card has expired. Please use a different payment method.",
        retryableWithSameMethod: false,
      };
    case "incorrect_cvc":
      return {
        customerMessage:
          "The security code entered was incorrect. Please check your card details and try again.",
        retryableWithSameMethod: true,
      };
    case "processing_error":
      return {
        customerMessage:
          "We couldn't process your payment due to a temporary issue. Please try again.",
        retryableWithSameMethod: true,
      };
    case "card_declined":
    case "lost_card":
    case "stolen_card":
    case "fraud_suspected":
      return {
        customerMessage: GENERIC_DECLINE_MESSAGE,
        retryableWithSameMethod: false,
      };
    default: {
      const exhaustive: never = code;
      throw new Error(`Unhandled decline code: ${String(exhaustive)}`);
    }
  }
}
