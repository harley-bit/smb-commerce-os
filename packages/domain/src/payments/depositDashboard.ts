import type { DepositState } from "./depositStateMachine.js";

/**
 * `docs/cards/D119.md` — Deposit management view. Pure domain math, no I/O
 * — same shape as `depositStateMachine.ts`. There is no design-doc-mandated
 * threshold for "expiring soon" (unlike the 30-day authorization-window
 * ceiling, `authorizationWindow.ts`), so this is a product judgment call:
 * 72 hours ahead of `expires_at`, comfortably inside the shortest real
 * provider window (~7 days, per `authorizationWindow.ts`'s own doc
 * comment) so a merchant always sees a hold before `DepositAutoReleaseJob`
 * (D080) or the provider itself would otherwise resolve it. Exported as a
 * named constant, not inlined, so a future card can override or reference
 * the same number rather than re-guessing it.
 */
export const DEPOSIT_EXPIRING_SOON_WINDOW_HOURS = 72;

export type DepositDashboardBucket = "HELD" | "EXPIRING_SOON" | "CAPTURED" | "RELEASED" | "EXPIRED";

/**
 * Buckets a single deposit authorization for the dashboard. Only an
 * `AUTHORIZED` hold can ever be `EXPIRING_SOON` — every other state is
 * already resolved (or terminal-and-unresolved, for `EXPIRED`) and maps to
 * exactly one bucket regardless of `expiresAt`. A hold whose `expiresAt`
 * has already passed but is still `AUTHORIZED` (the sweeper hasn't run
 * yet) is `EXPIRING_SOON`, not `HELD` — this card's acceptance criterion
 * ("expiring holds surfaced before they lapse") fails closed rather than
 * silently hiding a hold that's overdue for release.
 */
export function classifyDepositForDashboard(
  state: DepositState,
  expiresAt: string,
  now: string,
  windowHours: number = DEPOSIT_EXPIRING_SOON_WINDOW_HOURS,
): DepositDashboardBucket {
  switch (state) {
    case "RELEASED":
      return "RELEASED";
    case "CAPTURED":
    case "PARTIALLY_CAPTURED":
      return "CAPTURED";
    case "EXPIRED":
      return "EXPIRED";
    case "AUTHORIZED": {
      const msUntilExpiry = new Date(expiresAt).getTime() - new Date(now).getTime();
      const windowMs = windowHours * 60 * 60 * 1000;
      return msUntilExpiry <= windowMs ? "EXPIRING_SOON" : "HELD";
    }
  }
}
