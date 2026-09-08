/**
 * Damage claim state machine — `docs/design/03`'s "Rental lifecycle" section:
 * `state` ∈ `DRAFT | FILED | CUSTOMER_NOTIFIED | RESOLVED_CAPTURED |
 * RESOLVED_WAIVED | DISPUTED`. `RESOLVED_CAPTURED`/`RESOLVED_WAIVED` are
 * terminal; `DISPUTED` is not, since a disputed claim still has to resolve
 * one way or the other.
 *
 * Pure domain math, no I/O — same shape as `reservationStateMachine.ts`.
 * `applyDamageClaimEvent` is the only way to move a claim from one state to
 * another: there is no exported setter, so a caller cannot assign `state`
 * directly without going through an event.
 *
 * `DISPUTE` is `docs/cards/D076.md`'s security check made structural: it is
 * the *only* event this state machine reaches from `CUSTOMER_NOTIFIED` that
 * isn't a merchant resolving the claim unilaterally — it exists so the
 * customer's response to a claim against them has a legal, first-class state
 * to land in, not just a note field a merchant could ignore.
 */

export type DamageClaimState =
  | "DRAFT"
  | "FILED"
  | "CUSTOMER_NOTIFIED"
  | "RESOLVED_CAPTURED"
  | "RESOLVED_WAIVED"
  | "DISPUTED";

export type DamageClaimEventType =
  | "FILE"
  | "NOTIFY_CUSTOMER"
  | "DISPUTE"
  | "RESOLVE_CAPTURED"
  | "RESOLVE_WAIVED";

export interface DamageClaimEvent {
  readonly type: DamageClaimEventType;
}

export const TERMINAL_DAMAGE_CLAIM_STATES: ReadonlySet<DamageClaimState> = new Set([
  "RESOLVED_CAPTURED",
  "RESOLVED_WAIVED",
]);

export class IllegalDamageClaimTransitionError extends Error {
  constructor(
    public readonly fromState: DamageClaimState,
    public readonly event: DamageClaimEventType,
  ) {
    super(`Illegal damage claim transition: cannot apply "${event}" from state "${fromState}"`);
    this.name = "IllegalDamageClaimTransitionError";
  }
}

const TRANSITIONS: Record<DamageClaimState, Partial<Record<DamageClaimEventType, DamageClaimState>>> = {
  DRAFT: {
    FILE: "FILED",
  },
  FILED: {
    NOTIFY_CUSTOMER: "CUSTOMER_NOTIFIED",
  },
  CUSTOMER_NOTIFIED: {
    DISPUTE: "DISPUTED",
    RESOLVE_CAPTURED: "RESOLVED_CAPTURED",
    RESOLVE_WAIVED: "RESOLVED_WAIVED",
  },
  DISPUTED: {
    RESOLVE_CAPTURED: "RESOLVED_CAPTURED",
    RESOLVE_WAIVED: "RESOLVED_WAIVED",
  },
  RESOLVED_CAPTURED: {},
  RESOLVED_WAIVED: {},
};

/**
 * The single entry point for moving a damage claim from one state to
 * another. Throws `IllegalDamageClaimTransitionError` for any event not
 * explicitly listed for the current state — this includes every event on a
 * terminal state (`RESOLVED_CAPTURED`/`RESOLVED_WAIVED`), since those have no
 * entries in `TRANSITIONS`.
 */
export function applyDamageClaimEvent(
  currentState: DamageClaimState,
  event: DamageClaimEvent,
): DamageClaimState {
  const nextState = TRANSITIONS[currentState][event.type];
  if (nextState === undefined) {
    throw new IllegalDamageClaimTransitionError(currentState, event.type);
  }
  return nextState;
}
