export interface FetchRentalAvailabilityDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchRentalAvailabilityResult = { ok: true; available: boolean } | { ok: false };

/**
 * `docs/cards/D144.md` — the mobile rental date-range check, calling the
 * same unauthenticated `GET .../rental-availability` route the web
 * storefront's `RentalDetailView.tsx` reads
 * (`apps/api/src/routes/publicStorefront.ts`). The response shape this
 * function reads (`{ available: boolean }`) never carries a unit id,
 * reservation id, or customer name — only a bare boolean — and this helper
 * passes it through verbatim.
 */
export async function fetchRentalAvailability(
  deps: FetchRentalAvailabilityDeps,
  slug: string,
  listingSlug: string,
  variantId: string,
  from: string,
  to: string,
): Promise<FetchRentalAvailabilityResult> {
  const url = `${deps.baseUrl}/v1/m/${slug}/listings/${listingSlug}/rental-availability?variantId=${encodeURIComponent(variantId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await deps.fetchFn(url, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false };
  }

  const body: unknown = await response.json();
  const available = typeof body === "object" && body !== null ? (body as { available?: unknown }).available : undefined;
  if (typeof available !== "boolean") {
    return { ok: false };
  }

  return { ok: true, available };
}
