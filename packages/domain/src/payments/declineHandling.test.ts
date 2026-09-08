import { describe, expect, it } from "vitest";
import { mapDeclineToCustomerMessage, type DeclineCode } from "./declineHandling.js";

describe("mapDeclineToCustomerMessage (D098)", () => {
  it("gives an actionable, retryable-with-same-method message for a transient processing error", () => {
    const outcome = mapDeclineToCustomerMessage("processing_error");
    expect(outcome.retryableWithSameMethod).toBe(true);
    expect(outcome.customerMessage.length).toBeGreaterThan(0);
  });

  it("gives an actionable, retryable-with-same-method message for a mistyped CVC", () => {
    const outcome = mapDeclineToCustomerMessage("incorrect_cvc");
    expect(outcome.retryableWithSameMethod).toBe(true);
  });

  it("tells the customer to use a different method for insufficient funds", () => {
    const outcome = mapDeclineToCustomerMessage("insufficient_funds");
    expect(outcome.retryableWithSameMethod).toBe(false);
    expect(outcome.customerMessage.toLowerCase()).toContain("insufficient funds");
  });

  it("tells the customer to use a different method for an expired card", () => {
    const outcome = mapDeclineToCustomerMessage("expired_card");
    expect(outcome.retryableWithSameMethod).toBe(false);
    expect(outcome.customerMessage.toLowerCase()).toContain("expired");
  });

  const fraudAdjacentCodes: DeclineCode[] = ["card_declined", "lost_card", "stolen_card", "fraud_suspected"];

  it("collapses every fraud-adjacent decline onto the exact same generic message (security check: no leak of the real reason)", () => {
    const outcomes = fraudAdjacentCodes.map((code) => mapDeclineToCustomerMessage(code));
    const distinctMessages = new Set(outcomes.map((o) => o.customerMessage));
    expect(distinctMessages.size).toBe(1);
    for (const outcome of outcomes) {
      expect(outcome.retryableWithSameMethod).toBe(false);
    }
  });

  it("never reveals the lost/stolen/fraud reason itself in the customer-facing text", () => {
    for (const code of fraudAdjacentCodes) {
      const { customerMessage } = mapDeclineToCustomerMessage(code);
      expect(customerMessage.toLowerCase()).not.toContain("lost");
      expect(customerMessage.toLowerCase()).not.toContain("stolen");
      expect(customerMessage.toLowerCase()).not.toContain("fraud");
    }
  });
});
