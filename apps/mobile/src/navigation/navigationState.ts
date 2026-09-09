import type { Screen } from "./routes";

export interface NavigationState {
  current: Screen;
  stack: Screen[];
}

export type NavigationAction =
  | { type: "push"; screen: Screen }
  | { type: "goBack" }
  | { type: "reset"; screen: Screen };

/** Every app launch starts unauthenticated, on `SignIn`, with no history — same posture as the web storefront's `/login`. */
export function initialNavigationState(): NavigationState {
  return { current: { name: "SignIn", params: {} }, stack: [] };
}

/**
 * `docs/cards/D139.md` — a plain stack reducer, not a routing library: it
 * carries no native dependency (D137's native-build blockers are still
 * fresh), so D140+'s screens can be plugged into it without any new native
 * linking risk. `push`/`goBack`/`reset` mirror the three transitions the
 * web storefront needs (drill into a listing, back out of it, and the
 * sign-in -> home transition that must not leave `SignIn` on the back
 * stack).
 */
export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case "push":
      return { current: action.screen, stack: [...state.stack, state.current] };
    case "goBack": {
      if (state.stack.length === 0) {
        return state;
      }
      const stack = state.stack.slice(0, -1);
      const previous = state.stack[state.stack.length - 1]!;
      return { current: previous, stack };
    }
    case "reset":
      return { current: action.screen, stack: [] };
  }
}
