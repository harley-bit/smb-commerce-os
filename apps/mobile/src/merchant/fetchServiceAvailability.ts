export interface FreeInterval {
  start: string;
  end: string;
}

export interface FetchServiceAvailabilityDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchServiceAvailabilityResult = { ok: true; free: FreeInterval[] } | { ok: false };

function isFreeIntervalArray(value: unknown): value is FreeInterval[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "object" && entry !== null && typeof (entry as FreeInterval).start === "string" && typeof (entry as FreeInterval).end === "string")
  );
}

/**
 * `docs/cards/D143.md` — the mobile slot-picker fetch, calling the same
 * unauthenticated `GET /v1/m/{slug}/availability` route the web storefront's
 * `ServiceDetailView.tsx` reads (`apps/api/src/routes/availability.ts`).
 * This card's security check, "Free/busy only": the response shape this
 * function reads (`{ free: Interval[] }`) never carries a reservation id or
 * customer name — only bare `start`/`end` instants — and this helper passes
 * every entry through verbatim, never inventing or filtering one, so every
 * interval returned is already free by construction. This card's acceptance
 * criterion, "Only free slots selectable," is completed by the caller
 * (`./ServiceDetailScreen.tsx`), which renders exactly this array as
 * selectable buttons and nothing else.
 */
export async function fetchServiceAvailability(
  deps: FetchServiceAvailabilityDeps,
  slug: string,
  resourceId: string,
  from: string,
  to: string,
): Promise<FetchServiceAvailabilityResult> {
  const url = `${deps.baseUrl}/v1/m/${slug}/availability?resourceId=${encodeURIComponent(resourceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await deps.fetchFn(url, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false };
  }

  const body: unknown = await response.json();
  const free = typeof body === "object" && body !== null ? (body as { free?: unknown }).free : undefined;
  if (!isFreeIntervalArray(free)) {
    return { ok: false };
  }

  return { ok: true, free };
}
