import { publicProductDetailSchema, type PublicProductDetail } from "@smb-os/contracts";

export interface FetchProductDetailDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchProductDetailResult = { ok: true; detail: PublicProductDetail } | { ok: false; reason: "not-found" | "wrong-mode" | "invalid" };

/**
 * `docs/cards/D142.md` — the mobile product listing detail fetch, mirroring
 * `apps/web/src/app/m/[slug]/l/[listingSlug]/ProductDetailView.tsx`'s call to
 * the same unauthenticated `GET /v1/m/{slug}/listings/{listingSlug}`. This
 * card's security check ("prices fetched server-side, never cached stale")
 * is answered by construction: every call is a fresh, `cache: "no-store"`
 * `fetchFn` invocation with no persistence layer anywhere in this module or
 * its caller (`./ProductDetailScreen.tsx`) — there is nowhere a stale price
 * could be read from even if the merchant changes it between screens.
 */
export async function fetchProductDetail(
  deps: FetchProductDetailDeps,
  slug: string,
  listingSlug: string,
): Promise<FetchProductDetailResult> {
  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings/${listingSlug}`, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false, reason: "not-found" };
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || (body as { mode?: unknown }).mode !== "PRODUCT") {
    return { ok: false, reason: "wrong-mode" };
  }

  const result = publicProductDetailSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, detail: result.data };
}
