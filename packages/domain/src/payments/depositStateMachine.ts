/**
 * Deposit state machine — `docs/design/03`'s `deposit_authorizations.state`:
 * `AUTHORIZED | RELEASED | CAPTURED | PARTIALLY_CAPTURED | EXPIRED`. All
 * states but `AUTHORIZED` are terminal — `docs/design/14`'s T3 risk
 * ("deposit state corruption") calls for single-capture enforcement, so once
 * a hold is resolved one way there is no path back into it or on to another
 * resolution.
 *
 * Pure domain math, no I/O — same shape as `damageClaimStateMachine.ts`.
 * `applyDepositEvent` is the only way to move a deposit from one state to
 * another: there is no exported setter, so a caller cannot assign `state`
 * directly without going through an event.
 *
 * `CAPTURE` additionally enforces `docs/design/07`'s "capture amount bounded
 * by authorized amount" control here in the domain layer, not just at the
 * repository/service boundary: an out-of-bounds or non-positive capture
 * amount is an illegal transition, not a value that reaches a stored state.
 */

export type DepositState =
  | "AUTHORIZED"
  | "RELEASED"
  | "CAPTURED"
  | "PARTIALLY_CAPTURED"
  | "EXPIRED";

export type DepositEvent =
  | { readonly type: "RELEASE" }
  | { readonly type: "CAPTURE"; readonly amountMinor: number }
  | { readonly type: "EXPIRE" };

export interface DepositAuthorizationContext {
  readonly authorizedMinor: number;
}

export const TERMINAL_DEPOSIT_STATES: ReadonlySet<DepositState> = new Set([
  "RELEASED",
  "CAPTURED",
  "PARTIALLY_CAPTURED",
  "EXPIRED",
]);

export class IllegalDepositTransitionError extends Error {
  constructor(
    public readonly fromState: DepositState,
    public readonly event: DepositEvent["type"],
  ) {
    super(`Illegal deposit transition: cannot apply "${event}" from state "${fromState}"`);
    this.name = "IllegalDepositTransitionError";
  }
}

/**
 * The single entry point for moving a deposit authorization from one state
 * to another. Throws `IllegalDepositTransitionError` for any event not
 * legal from the current state (including every event on a terminal
 * state), and for a `CAPTURE` whose `amountMinor` is non-positive or
 * exceeds `context.authorizedMinor`.
 */
export function applyDepositEvent(
  currentState: DepositState,
  event: DepositEvent,
  context: DepositAuthorizationContext,
): DepositState {
  if (currentState !== "AUTHORIZED") {
    throw new IllegalDepositTransitionError(currentState, event.type);
  }

  switch (event.type) {
    case "RELEASE":
      return "RELEASED";
    case "EXPIRE":
      return "EXPIRED";
    case "CAPTURE":
      if (event.amountMinor <= 0 || event.amountMinor > context.authorizedMinor) {
        throw new IllegalDepositTransitionError(currentState, event.type);
      }
      return event.amountMinor === context.authorizedMinor ? "CAPTURED" : "PARTIALLY_CAPTURED";
  }
}
