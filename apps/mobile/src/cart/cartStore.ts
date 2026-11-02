import { computeHoldCountdown, type HoldCountdown } from "@smb-os/domain";

export type CartLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

/**
 * A time-bound listing (SERVICE/RENTAL) holds the customer's selection for
 * this long before it expires and has to be re-picked — same "give the
 * customer a window, then let it lapse" shape as `HoldExpirySweeper`
 * (`packages/db/src/jobs/HoldExpirySweeper.ts`) uses server-side for a real
 * reservation, just held client-side here since no cart HTTP route exists
 * yet (`docs/cards/D142.md`'s log).
 */
export const HOLD_DURATION_MS = 10 * 60_000;

export interface CartLine {
  id: string;
  mode: CartLineMode;
  slug: string;
  listingSlug: string;
  variantId: string;
  name: string;
  unitPriceMinor: number;
  currency: string;
  quantity: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Generated once, at add time, and carried unchanged from here to whatever creation call eventually fires — this card's security check. */
  idempotencyKey: string;
  /** ISO instant the hold on this line lapses, or `null` for a PRODUCT line (no hold — stock isn't time-bound). */
  expiresAt: string | null;
}

export interface CartState {
  lines: CartLine[];
}

export function createEmptyCart(): CartState {
  return { lines: [] };
}

export interface AddLineInput {
  mode: CartLineMode;
  slug: string;
  listingSlug: string;
  variantId: string;
  name: string;
  unitPriceMinor: number;
  currency: string;
  quantity?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface CartLineGenerators {
  generateLineId: () => string;
  generateIdempotencyKey: () => string;
}

export function addLine(cart: CartState, input: AddLineInput, generators: CartLineGenerators, now: Date): CartState {
  const line: CartLine = {
    id: generators.generateLineId(),
    mode: input.mode,
    slug: input.slug,
    listingSlug: input.listingSlug,
    variantId: input.variantId,
    name: input.name,
    unitPriceMinor: input.unitPriceMinor,
    currency: input.currency,
    quantity: input.quantity ?? 1,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    idempotencyKey: generators.generateIdempotencyKey(),
    expiresAt: input.mode === "PRODUCT" ? null : new Date(now.getTime() + HOLD_DURATION_MS).toISOString(),
  };
  return { lines: [...cart.lines, line] };
}

export function removeLine(cart: CartState, lineId: string): CartState {
  return { lines: cart.lines.filter((line) => line.id !== lineId) };
}

export interface CartLineStatus {
  line: CartLine;
  /** `null` for a line with no hold (PRODUCT) — there is nothing to count down. */
  countdown: HoldCountdown | null;
}

/**
 * Pure function of `cart` and `now` — no `Date.now()`, no storage read, no
 * network call inside it. That is what makes "hold expiry handled
 * gracefully offline and online" (this card's acceptance criterion) true
 * by construction rather than by a special-cased offline branch: a caller
 * ticking this every second under a live clock and a caller re-deriving it
 * once after being offline for an hour run the exact same code path.
 */
export function selectCartLineStatuses(cart: CartState, now: Date): CartLineStatus[] {
  return cart.lines.map((line) => ({
    line,
    countdown: line.expiresAt ? computeHoldCountdown(line.expiresAt, now) : null,
  }));
}
