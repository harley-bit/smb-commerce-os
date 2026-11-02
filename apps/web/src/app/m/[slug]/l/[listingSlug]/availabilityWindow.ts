const NINETY_DAY_CAP_MS = 90 * 24 * 60 * 60 * 1000;

export interface MonthWindow {
  from: string;
  to: string;
  windowStart: Date;
  canGoNext: boolean;
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

/**
 * `docs/cards/D125.md`'s calendar page for `monthsAhead` pages forward from
 * `now`. Page 0 starts at `now` itself (today's remaining availability, not
 * the 1st of the current month); every later page is a full calendar month.
 *
 * This card's security check — "90-day request cap respected by the
 * client" — is `AvailabilityService`'s own 90-day cap
 * (`packages/db/src/services/AvailabilityService.ts`,
 * `AvailabilityRangeTooLargeError`), mirrored here rather than left for the
 * server to reject: `to` is clamped at `now + 90 days`, and `canGoNext` goes
 * `false` the moment a page's natural end would cross that cap, so the
 * caller can disable "next month" and never issue an over-wide request.
 */
export function computeMonthWindow(now: Date, monthsAhead: number): MonthWindow {
  const cap = new Date(now.getTime() + NINETY_DAY_CAP_MS);
  const windowStart = monthsAhead === 0 ? now : addUtcMonths(now, monthsAhead);
  const naturalEnd = addUtcMonths(now, monthsAhead + 1);
  const isCapped = naturalEnd.getTime() >= cap.getTime();
  const windowEnd = isCapped ? cap : naturalEnd;
  return {
    from: windowStart.toISOString(),
    to: windowEnd.toISOString(),
    windowStart,
    canGoNext: !isCapped,
  };
}

/** Deterministic month/year label, always read in UTC — matches `computeMonthWindow`'s UTC month boundaries. */
export function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
