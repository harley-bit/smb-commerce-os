import { type Interval, makeInterval } from "./interval.js";

/**
 * One-off override to a base `AvailabilityRule` — `docs/design/03`
 * `availability_exceptions` table. `BLACKOUT` removes time from the base
 * rule's expanded intervals (holidays, sick days); `EXTRA` adds a one-off
 * opening beyond it.
 */
export interface AvailabilityException {
  readonly kind: "BLACKOUT" | "EXTRA";
  readonly interval: Interval;
}

function subtractOne(intervals: readonly Interval[], subtrahend: Interval): Interval[] {
  const subStartMs = Date.parse(subtrahend.start);
  const subEndMs = Date.parse(subtrahend.end);
  const result: Interval[] = [];
  for (const current of intervals) {
    const startMs = Date.parse(current.start);
    const endMs = Date.parse(current.end);
    if (subEndMs <= startMs || subStartMs >= endMs) {
      // No overlap.
      result.push(current);
      continue;
    }
    if (subStartMs > startMs) {
      result.push(makeInterval(current.start, subtrahend.start));
    }
    if (subEndMs < endMs) {
      result.push(makeInterval(subtrahend.end, current.end));
    }
  }
  return result;
}

/**
 * Removes every `subtrahend` interval from `intervals` (full removal, split,
 * or trim as needed). Order of subtrahends does not affect the result — set
 * difference against a union of removals is order-independent. Shared by
 * `applyAvailabilityExceptions` (BLACKOUT) and D048's `computeFreeIntervals`
 * (blocking reservations).
 */
export function subtractIntervals(
  intervals: readonly Interval[],
  subtrahends: readonly Interval[],
): Interval[] {
  let remaining: Interval[] = [...intervals];
  for (const subtrahend of subtrahends) {
    remaining = subtractOne(remaining, subtrahend);
  }
  return remaining;
}

function mergeSorted(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && Date.parse(current.start) <= Date.parse(last.end)) {
      if (Date.parse(current.end) > Date.parse(last.end)) {
        merged[merged.length - 1] = makeInterval(last.start, current.end);
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * Applies BLACKOUT/EXTRA exceptions to a base rule's expanded intervals.
 * BLACKOUTs are subtracted first (splitting or trimming a base interval as
 * needed), then EXTRA one-off openings are unioned in, merging any that
 * overlap or abut the result — the card's "exception overrides base rule"
 * acceptance criterion.
 */
export function applyAvailabilityExceptions(
  baseIntervals: readonly Interval[],
  exceptions: readonly AvailabilityException[],
): Interval[] {
  for (const exception of exceptions) {
    makeInterval(exception.interval.start, exception.interval.end);
  }

  const blackouts = exceptions.filter((e) => e.kind === "BLACKOUT").map((e) => e.interval);
  const remaining = subtractIntervals(baseIntervals, blackouts);
  const extras = exceptions.filter((e) => e.kind === "EXTRA").map((e) => e.interval);
  return mergeSorted([...remaining, ...extras]);
}
