import { parseUtcIso } from "../utils/time.js";

/**
 * `docs/cards/D127.md` — pure math behind the storefront's visible hold
 * countdown. No I/O, no `Date.now()` inside: `now` is always caller-supplied
 * (same posture as `expandIntervalForBuffer`/`selectUnitForAllocation`),
 * so a UI can tick this every second under a real clock while tests drive
 * it with fixed instants.
 */
export interface HoldCountdown {
  msRemaining: number;
  expired: boolean;
}

export function computeHoldCountdown(expiresAt: string, now: Date): HoldCountdown {
  const msRemaining = Math.max(parseUtcIso(expiresAt).getTime() - now.getTime(), 0);
  return { msRemaining, expired: msRemaining <= 0 };
}
