/**
 * Reservation state machine — `docs/design/03`'s "The reservation — services
 * and rentals" section: `state` ∈ `HELD | CONFIRMED | IN_USE | COMPLETED |
 * CANCELLED | EXPIRED`. Blocking states are `HELD`, `CONFIRMED`, `IN_USE`;
 * `COMPLETED`, `CANCELLED`, `EXPIRED` are terminal.
 *
 * Pure domain math, no I/O — same shape as `availabilityRule.ts` /
 * `freeIntervals.ts`. `applyReservationEvent` is the only way to move a
 * reservation from one state to another: there is no exported setter, so a
 * caller cannot assign `state` directly without going through an event.
 */

export type ReservationState = "HELD" | "CONFIRMED" | "IN_USE" | "COMPLETED" | "CANCELLED" | "EXPIRED";

export type ReservationEventType =
  | "CONFIRM"
  | "EXPIRE"
  | "PICKED_UP"
  | "RETURNED"
  | "NO_SHOW"
  | "COMPLETED"
  | "CANCELLED";

export interface ReservationEvent {
  readonly type: ReservationEventType;
}

/** `docs/design/03` line 130: every overlap query filters on this set. */
export const BLOCKING_RESERVATION_STATES: ReadonlySet<ReservationState> = new Set([
  "HELD",
  "CONFIRMED",
  "IN_USE",
]);

export const TERMINAL_RESERVATION_STATES: ReadonlySet<ReservationState> = new Set([
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);

export class IllegalReservationTransitionError extends Error {
  constructor(
    public readonly fromState: ReservationState,
    public readonly event: ReservationEventType,
  ) {
    super(`Illegal reservation transition: cannot apply "${event}" from state "${fromState}"`);
    this.name = "IllegalReservationTransitionError";
  }
}

const TRANSITIONS: Record<ReservationState, Partial<Record<ReservationEventType, ReservationState>>> = {
  HELD: {
    CONFIRM: "CONFIRMED",
    CANCELLED: "CANCELLED",
    EXPIRE: "EXPIRED",
  },
  CONFIRMED: {
    PICKED_UP: "IN_USE",
    NO_SHOW: "CANCELLED",
    CANCELLED: "CANCELLED",
  },
  IN_USE: {
    RETURNED: "COMPLETED",
    COMPLETED: "COMPLETED",
  },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

/**
 * The single entry point for moving a reservation from one state to
 * another. Throws `IllegalReservationTransitionError` for any event not
 * explicitly listed for the current state — this includes every event on a
 * terminal state (`COMPLETED`/`CANCELLED`/`EXPIRED`), since those have no
 * entries in `TRANSITIONS`.
 */
export function applyReservationEvent(
  currentState: ReservationState,
  event: ReservationEvent,
): ReservationState {
  const nextState = TRANSITIONS[currentState][event.type];
  if (nextState === undefined) {
    throw new IllegalReservationTransitionError(currentState, event.type);
  }
  return nextState;
}
