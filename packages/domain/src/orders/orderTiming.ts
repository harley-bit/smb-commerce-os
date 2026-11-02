/**
 * `docs/cards/D132.md` — "Order history". Pure domain classification, no
 * I/O — same shape as `../payments/depositDisclosure.ts`. Whether an order
 * belongs in a customer's "upcoming" or "past" bucket depends on its own
 * lines' own recorded `startsAt`/`endsAt` (a SERVICE appointment or RENTAL
 * window), never on order status alone: a `CONFIRMED` order with a rental
 * still checked out is still "upcoming" from the customer's point of view,
 * and a `PRODUCT`-only order (no dated lines at all) has no future
 * occurrence to wait for, so it is always "past" once placed.
 */

export type OrderTimingBucket = "UPCOMING" | "PAST";

export interface OrderTimingLineInput {
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

export function classifyOrderTiming(lines: readonly OrderTimingLineInput[], now: string): OrderTimingBucket {
  const nowMs = new Date(now).getTime();
  const hasFutureDate = lines.some((line) => {
    return [line.startsAt, line.endsAt].some((value) => value !== null && new Date(value).getTime() > nowMs);
  });
  return hasFutureDate ? "UPCOMING" : "PAST";
}
