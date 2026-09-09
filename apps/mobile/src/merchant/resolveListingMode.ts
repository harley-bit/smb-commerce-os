export interface ResolveListingModeDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type ResolveListingModeResult =
  | { ok: true; mode: "PRODUCT" | "SERVICE" | "RENTAL" }
  | { ok: false; reason: "not-found" | "invalid" };

const KNOWN_MODES = new Set(["PRODUCT", "SERVICE", "RENTAL"]);

/**
 * `docs/cards/D143.md` — a lightweight mode probe so `App.tsx`'s single
 * `ListingDetail` route can dispatch to the right mode-specific screen
 * (`./ProductDetailScreen.tsx`, `./ServiceDetailScreen.tsx`, and a future
 * D144 rental screen), each of which still does its own complete
 * fetch-and-validate against `@smb-os/contracts` — this probe only ever
 * reads the `mode` field, it never substitutes for that full validation.
 */
export async function resolveListingMode(
  deps: ResolveListingModeDeps,
  slug: string,
  listingSlug: string,
): Promise<ResolveListingModeResult> {
  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings/${listingSlug}`, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false, reason: "not-found" };
  }

  const body: unknown = await response.json();
  const mode = typeof body === "object" && body !== null ? (body as { mode?: unknown }).mode : undefined;
  if (typeof mode !== "string" || !KNOWN_MODES.has(mode)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, mode: mode as "PRODUCT" | "SERVICE" | "RENTAL" };
}
