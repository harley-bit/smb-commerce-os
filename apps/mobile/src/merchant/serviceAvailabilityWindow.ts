const WINDOW_DAYS = 14;

export interface ServiceAvailabilityWindow {
  from: string;
  to: string;
}

/**
 * `docs/cards/D143.md` — a fixed 14-day availability window from `now`, the
 * same starting-point window `docs/cards/D123.md` originally shipped on web
 * before `docs/cards/D125.md` added month navigation there. Month navigation
 * is out of this card's scope (only "only free slots selectable" is the
 * acceptance criterion) — a future mobile card can add it the same way D125
 * did, reusing this pure window function as the base case.
 */
export function computeServiceAvailabilityWindow(now: Date): ServiceAvailabilityWindow {
  const to = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from: now.toISOString(), to: to.toISOString() };
}
