import { parseUtcIso, toUtcIso } from "../utils/time.js";

/**
 * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — a rental
 * variant's `buffer_minutes` (cleaning, inspection, charging) is applied by
 * expanding the interval **at write time**, not by complicating the overlap
 * predicate: `effective_start = requested_start`, `effective_end =
 * requested_end + buffer_minutes`. The caller is responsible for persisting
 * both the expanded `endsAt` and the `bufferMinutes` value it was expanded
 * with on the reservation row itself, so a later change to the variant's
 * buffer cannot retroactively alter an already-written booking.
 */
export function expandIntervalForBuffer(
  startsAt: string,
  endsAt: string,
  bufferMinutes: number | null | undefined,
): { startsAt: string; endsAt: string } {
  if (!bufferMinutes) {
    return { startsAt, endsAt };
  }
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) {
    throw new Error(`bufferMinutes must be a non-negative integer, got: ${bufferMinutes}`);
  }

  const expandedEndsAt = toUtcIso(new Date(parseUtcIso(endsAt).getTime() + bufferMinutes * 60_000));
  return { startsAt, endsAt: expandedEndsAt };
}
