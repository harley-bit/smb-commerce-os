import { describe, expect, it } from "vitest";
import {
  applyReservationEvent,
  BLOCKING_RESERVATION_STATES,
  IllegalReservationTransitionError,
  TERMINAL_RESERVATION_STATES,
  type ReservationState,
} from "./reservationStateMachine.js";

describe("reservationStateMachine", () => {
  it("HELD -> CONFIRMED on CONFIRM", () => {
    expect(applyReservationEvent("HELD", { type: "CONFIRM" })).toBe("CONFIRMED");
  });

  it("HELD -> CANCELLED on CANCELLED", () => {
    expect(applyReservationEvent("HELD", { type: "CANCELLED" })).toBe("CANCELLED");
  });

  it("HELD -> EXPIRED on EXPIRE", () => {
    expect(applyReservationEvent("HELD", { type: "EXPIRE" })).toBe("EXPIRED");
  });

  it("CONFIRMED -> IN_USE on PICKED_UP", () => {
    expect(applyReservationEvent("CONFIRMED", { type: "PICKED_UP" })).toBe("IN_USE");
  });

  it("CONFIRMED -> CANCELLED on NO_SHOW", () => {
    expect(applyReservationEvent("CONFIRMED", { type: "NO_SHOW" })).toBe("CANCELLED");
  });

  it("CONFIRMED -> CANCELLED on CANCELLED", () => {
    expect(applyReservationEvent("CONFIRMED", { type: "CANCELLED" })).toBe("CANCELLED");
  });

  it("IN_USE -> COMPLETED on RETURNED", () => {
    expect(applyReservationEvent("IN_USE", { type: "RETURNED" })).toBe("COMPLETED");
  });

  it("IN_USE -> COMPLETED on COMPLETED (service with no physical return)", () => {
    expect(applyReservationEvent("IN_USE", { type: "COMPLETED" })).toBe("COMPLETED");
  });

  it("rejects an illegal transition (HELD cannot receive RETURNED)", () => {
    expect(() => applyReservationEvent("HELD", { type: "RETURNED" })).toThrow(
      IllegalReservationTransitionError,
    );
  });

  it("rejects an illegal transition (CONFIRMED cannot receive EXPIRE)", () => {
    expect(() => applyReservationEvent("CONFIRMED", { type: "EXPIRE" })).toThrow(
      IllegalReservationTransitionError,
    );
  });

  it("rejects an illegal transition (IN_USE cannot receive CONFIRM)", () => {
    expect(() => applyReservationEvent("IN_USE", { type: "CONFIRM" })).toThrow(
      IllegalReservationTransitionError,
    );
  });

  const terminalStates: ReservationState[] = ["COMPLETED", "CANCELLED", "EXPIRED"];
  const allEvents = [
    { type: "CONFIRM" as const },
    { type: "EXPIRE" as const },
    { type: "PICKED_UP" as const },
    { type: "RETURNED" as const },
    { type: "NO_SHOW" as const },
    { type: "COMPLETED" as const },
    { type: "CANCELLED" as const },
  ];

  for (const terminalState of terminalStates) {
    for (const event of allEvents) {
      it(`terminal state ${terminalState} rejects every event (${event.type})`, () => {
        expect(() => applyReservationEvent(terminalState, event)).toThrow(
          IllegalReservationTransitionError,
        );
      });
    }
  }

  it("error carries the offending fromState and event type", () => {
    try {
      applyReservationEvent("EXPIRED", { type: "CONFIRM" });
      throw new Error("expected applyReservationEvent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalReservationTransitionError);
      const illegal = error as IllegalReservationTransitionError;
      expect(illegal.fromState).toBe("EXPIRED");
      expect(illegal.event).toBe("CONFIRM");
    }
  });

  it("BLOCKING_RESERVATION_STATES matches docs/design/03's blocking-state set", () => {
    expect(BLOCKING_RESERVATION_STATES.has("HELD")).toBe(true);
    expect(BLOCKING_RESERVATION_STATES.has("CONFIRMED")).toBe(true);
    expect(BLOCKING_RESERVATION_STATES.has("IN_USE")).toBe(true);
    expect(BLOCKING_RESERVATION_STATES.has("COMPLETED")).toBe(false);
    expect(BLOCKING_RESERVATION_STATES.has("CANCELLED")).toBe(false);
    expect(BLOCKING_RESERVATION_STATES.has("EXPIRED")).toBe(false);
  });

  it("TERMINAL_RESERVATION_STATES matches the non-blocking state set", () => {
    expect(TERMINAL_RESERVATION_STATES.has("COMPLETED")).toBe(true);
    expect(TERMINAL_RESERVATION_STATES.has("CANCELLED")).toBe(true);
    expect(TERMINAL_RESERVATION_STATES.has("EXPIRED")).toBe(true);
    expect(TERMINAL_RESERVATION_STATES.has("HELD")).toBe(false);
    expect(TERMINAL_RESERVATION_STATES.has("CONFIRMED")).toBe(false);
    expect(TERMINAL_RESERVATION_STATES.has("IN_USE")).toBe(false);
  });
});
