import { describe, expect, it } from "vitest";
import {
  applyDamageClaimEvent,
  IllegalDamageClaimTransitionError,
  TERMINAL_DAMAGE_CLAIM_STATES,
  type DamageClaimState,
} from "./damageClaimStateMachine.js";

describe("damageClaimStateMachine", () => {
  it("DRAFT -> FILED on FILE", () => {
    expect(applyDamageClaimEvent("DRAFT", { type: "FILE" })).toBe("FILED");
  });

  it("FILED -> CUSTOMER_NOTIFIED on NOTIFY_CUSTOMER", () => {
    expect(applyDamageClaimEvent("FILED", { type: "NOTIFY_CUSTOMER" })).toBe("CUSTOMER_NOTIFIED");
  });

  it("CUSTOMER_NOTIFIED -> DISPUTED on DISPUTE (the customer's response)", () => {
    expect(applyDamageClaimEvent("CUSTOMER_NOTIFIED", { type: "DISPUTE" })).toBe("DISPUTED");
  });

  it("CUSTOMER_NOTIFIED -> RESOLVED_CAPTURED on RESOLVE_CAPTURED", () => {
    expect(applyDamageClaimEvent("CUSTOMER_NOTIFIED", { type: "RESOLVE_CAPTURED" })).toBe(
      "RESOLVED_CAPTURED",
    );
  });

  it("CUSTOMER_NOTIFIED -> RESOLVED_WAIVED on RESOLVE_WAIVED", () => {
    expect(applyDamageClaimEvent("CUSTOMER_NOTIFIED", { type: "RESOLVE_WAIVED" })).toBe(
      "RESOLVED_WAIVED",
    );
  });

  it("DISPUTED -> RESOLVED_CAPTURED on RESOLVE_CAPTURED", () => {
    expect(applyDamageClaimEvent("DISPUTED", { type: "RESOLVE_CAPTURED" })).toBe("RESOLVED_CAPTURED");
  });

  it("DISPUTED -> RESOLVED_WAIVED on RESOLVE_WAIVED", () => {
    expect(applyDamageClaimEvent("DISPUTED", { type: "RESOLVE_WAIVED" })).toBe("RESOLVED_WAIVED");
  });

  it("rejects an illegal transition (DRAFT cannot receive NOTIFY_CUSTOMER)", () => {
    expect(() => applyDamageClaimEvent("DRAFT", { type: "NOTIFY_CUSTOMER" })).toThrow(
      IllegalDamageClaimTransitionError,
    );
  });

  it("rejects an illegal transition (FILED cannot receive DISPUTE — customer hasn't been notified yet)", () => {
    expect(() => applyDamageClaimEvent("FILED", { type: "DISPUTE" })).toThrow(
      IllegalDamageClaimTransitionError,
    );
  });

  it("rejects an illegal transition (DISPUTED cannot receive DISPUTE again)", () => {
    expect(() => applyDamageClaimEvent("DISPUTED", { type: "DISPUTE" })).toThrow(
      IllegalDamageClaimTransitionError,
    );
  });

  const terminalStates: DamageClaimState[] = ["RESOLVED_CAPTURED", "RESOLVED_WAIVED"];
  const allEvents = [
    { type: "FILE" as const },
    { type: "NOTIFY_CUSTOMER" as const },
    { type: "DISPUTE" as const },
    { type: "RESOLVE_CAPTURED" as const },
    { type: "RESOLVE_WAIVED" as const },
  ];

  for (const terminalState of terminalStates) {
    for (const event of allEvents) {
      it(`terminal state ${terminalState} rejects every event (${event.type})`, () => {
        expect(() => applyDamageClaimEvent(terminalState, event)).toThrow(
          IllegalDamageClaimTransitionError,
        );
      });
    }
  }

  it("error carries the offending fromState and event type", () => {
    try {
      applyDamageClaimEvent("RESOLVED_CAPTURED", { type: "DISPUTE" });
      throw new Error("expected applyDamageClaimEvent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalDamageClaimTransitionError);
      const illegal = error as IllegalDamageClaimTransitionError;
      expect(illegal.fromState).toBe("RESOLVED_CAPTURED");
      expect(illegal.event).toBe("DISPUTE");
    }
  });

  it("TERMINAL_DAMAGE_CLAIM_STATES matches the resolved-state set", () => {
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("RESOLVED_CAPTURED")).toBe(true);
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("RESOLVED_WAIVED")).toBe(true);
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("DRAFT")).toBe(false);
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("FILED")).toBe(false);
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("CUSTOMER_NOTIFIED")).toBe(false);
    expect(TERMINAL_DAMAGE_CLAIM_STATES.has("DISPUTED")).toBe(false);
  });
});
