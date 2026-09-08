import {
  applyAvailabilityExceptions,
  subtractIntervals,
  type AvailabilityException,
} from "./availabilityExceptions.js";
import { makeInterval, type Interval } from "./interval.js";

/**
 * Computes the free set for a subject over a range: base rule intervals,
 * minus BLACKOUT/plus EXTRA exceptions (D047), minus blocking reservations
 * (`docs/design/05` — `HELD`/`CONFIRMED`/`IN_USE`, the only states that
 * participate in overlap checks; callers must pre-filter to those states
 * and to non-expired `HELD` before calling).
 *
 * `blockingReservations` is typed as bare `Interval`s, not reservation rows —
 * this function has no way to return who booked a slot because it never
 * receives that information in the first place (this card's security check).
 */
export function computeFreeIntervals(
  baseIntervals: readonly Interval[],
  exceptions: readonly AvailabilityException[],
  blockingReservations: readonly Interval[],
): Interval[] {
  for (const blocking of blockingReservations) {
    makeInterval(blocking.start, blocking.end);
  }

  const afterExceptions = applyAvailabilityExceptions(baseIntervals, exceptions);
  return subtractIntervals(afterExceptions, blockingReservations);
}
