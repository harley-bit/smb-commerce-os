import { describe, expect, it } from "vitest";
import {
  applyDepositEvent,
  IllegalDepositTransitionError,
  TERMINAL_DEPOSIT_STATES,
  type DepositState,
} from "./depositStateMachine.js";

describe("depositStateMachine", () => {
  it("AUTHORIZED -> RELEASED on RELEASE", () => {
    expect(
      applyDepositEvent("AUTHORIZED", { type: "RELEASE" }, { authorizedMinor: 10_000 }),
    ).toBe("RELEASED");
  });

  it("AUTHORIZED -> CAPTURED on CAPTURE for the full authorized amount", () => {
    expect(
      applyDepositEvent(
        "AUTHORIZED",
        { type: "CAPTURE", amountMinor: 10_000 },
        { authorizedMinor: 10_000 },
      ),
    ).toBe("CAPTURED");
  });

  it("AUTHORIZED -> PARTIALLY_CAPTURED on CAPTURE for less than the authorized amount", () => {
    expect(
      applyDepositEvent(
        "AUTHORIZED",
        { type: "CAPTURE", amountMinor: 4_000 },
        { authorizedMinor: 10_000 },
      ),
    ).toBe("PARTIALLY_CAPTURED");
  });

  it("AUTHORIZED -> EXPIRED on EXPIRE", () => {
    expect(
      applyDepositEvent("AUTHORIZED", { type: "EXPIRE" }, { authorizedMinor: 10_000 }),
    ).toBe("EXPIRED");
  });

  it("rejects a capture above the authorized amount (T3: capture bounded by authorization)", () => {
    expect(() =>
      applyDepositEvent(
        "AUTHORIZED",
        { type: "CAPTURE", amountMinor: 10_001 },
        { authorizedMinor: 10_000 },
      ),
    ).toThrow(IllegalDepositTransitionError);
  });

  it("rejects a zero-amount capture", () => {
    expect(() =>
      applyDepositEvent(
        "AUTHORIZED",
        { type: "CAPTURE", amountMinor: 0 },
        { authorizedMinor: 10_000 },
      ),
    ).toThrow(IllegalDepositTransitionError);
  });

  it("rejects a negative-amount capture", () => {
    expect(() =>
      applyDepositEvent(
        "AUTHORIZED",
        { type: "CAPTURE", amountMinor: -1 },
        { authorizedMinor: 10_000 },
      ),
    ).toThrow(IllegalDepositTransitionError);
  });

  it("rejects RELEASE on an already-released deposit", () => {
    expect(() =>
      applyDepositEvent("RELEASED", { type: "RELEASE" }, { authorizedMinor: 10_000 }),
    ).toThrow(IllegalDepositTransitionError);
  });

  const terminalStates: DepositState[] = ["RELEASED", "CAPTURED", "PARTIALLY_CAPTURED", "EXPIRED"];
  const allEvents = [
    { type: "RELEASE" as const },
    { type: "CAPTURE" as const, amountMinor: 1_000 },
    { type: "EXPIRE" as const },
  ];

  for (const terminalState of terminalStates) {
    for (const event of allEvents) {
      it(`terminal state ${terminalState} rejects every event (${event.type}) — single-capture enforcement`, () => {
        expect(() =>
          applyDepositEvent(terminalState, event, { authorizedMinor: 10_000 }),
        ).toThrow(IllegalDepositTransitionError);
      });
    }
  }

  it("error carries the offending fromState and event type", () => {
    try {
      applyDepositEvent("CAPTURED", { type: "RELEASE" }, { authorizedMinor: 10_000 });
      throw new Error("expected applyDepositEvent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalDepositTransitionError);
      const illegal = error as IllegalDepositTransitionError;
      expect(illegal.fromState).toBe("CAPTURED");
      expect(illegal.event).toBe("RELEASE");
    }
  });

  it("TERMINAL_DEPOSIT_STATES matches the resolved-state set", () => {
    expect(TERMINAL_DEPOSIT_STATES.has("RELEASED")).toBe(true);
    expect(TERMINAL_DEPOSIT_STATES.has("CAPTURED")).toBe(true);
    expect(TERMINAL_DEPOSIT_STATES.has("PARTIALLY_CAPTURED")).toBe(true);
    expect(TERMINAL_DEPOSIT_STATES.has("EXPIRED")).toBe(true);
    expect(TERMINAL_DEPOSIT_STATES.has("AUTHORIZED")).toBe(false);
  });
});
