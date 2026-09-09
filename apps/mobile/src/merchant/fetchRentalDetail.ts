import { publicRentalDetailSchema, type PublicRentalDetail } from "@smb-os/contracts";

export interface FetchRentalDetailDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchRentalDetailResult = { ok: true; detail: PublicRentalDetail } | { ok: false; reason: "not-found" | "wrong-mode" | "invalid" };

/**
 * `docs/cards/D144.md` — the mobile rental listing detail fetch, mirroring
 * `./fetchServiceDetail.ts` (D143) and the web
 * `apps/web/src/app/m/[slug]/l/[listingSlug]/RentalDetailView.tsx`'s call to
 * the same unauthenticated `GET /v1/m/{slug}/listings/{listingSlug}`. Every
 * call is a fresh, `cache: "no-store"` fetch with no persistence layer — the
 * deposit/rate terms this feeds are never read from a stale cache.
 */
export async function fetchRentalDetail(
  deps: FetchRentalDetailDeps,
  slug: string,
  listingSlug: string,
): Promise<FetchRentalDetailResult> {
  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings/${listingSlug}`, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false, reason: "not-found" };
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || (body as { mode?: unknown }).mode !== "RENTAL") {
    return { ok: false, reason: "wrong-mode" };
  }

  const result = publicRentalDetailSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, detail: result.data };
}
