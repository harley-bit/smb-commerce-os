import { publicServiceDetailSchema, type PublicServiceDetail } from "@smb-os/contracts";

export interface FetchServiceDetailDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchServiceDetailResult = { ok: true; detail: PublicServiceDetail } | { ok: false; reason: "not-found" | "wrong-mode" | "invalid" };

/**
 * `docs/cards/D143.md` — the mobile service listing detail fetch, mirroring
 * `./fetchProductDetail.ts` (D142) and the web
 * `apps/web/src/app/m/[slug]/l/[listingSlug]/ServiceDetailView.tsx`'s call to
 * the same unauthenticated `GET /v1/m/{slug}/listings/{listingSlug}`. Every
 * call is a fresh, `cache: "no-store"` fetch with no persistence layer, same
 * "never cached stale" posture D142 established.
 */
export async function fetchServiceDetail(
  deps: FetchServiceDetailDeps,
  slug: string,
  listingSlug: string,
): Promise<FetchServiceDetailResult> {
  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings/${listingSlug}`, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false, reason: "not-found" };
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || (body as { mode?: unknown }).mode !== "SERVICE") {
    return { ok: false, reason: "wrong-mode" };
  }

  const result = publicServiceDetailSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, detail: result.data };
}
