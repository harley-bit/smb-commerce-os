import { publicListingSchema, type ListingMode, type PublicListing } from "@smb-os/contracts";

export interface FetchCatalogPageDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export interface CatalogPageOptions {
  mode?: ListingMode;
  cursor?: string;
  limit: number;
}

export type FetchCatalogPageResult =
  | { ok: true; listings: PublicListing[]; nextCursor: string | null }
  | { ok: false; error: string };

/**
 * `docs/cards/D141.md`'s catalog browse: one page of `GET
 * /v1/m/{slug}/listings`, calling the same cursor-pagination the API added
 * for this card (`apps/api/src/routes/publicStorefront.ts`) — `cursor` is
 * always the opaque value the server itself handed back in a prior page's
 * `X-Next-Cursor` response header, never a caller-computed offset/index
 * (this card's security check, the client-side half: nothing here could
 * even construct an offset-shaped request if it wanted to, since the only
 * paging input this function accepts is that header's own value).
 */
export async function fetchCatalogPage(
  deps: FetchCatalogPageDeps,
  slug: string,
  options: CatalogPageOptions,
): Promise<FetchCatalogPageResult> {
  const params = new URLSearchParams();
  if (options.mode !== undefined) params.set("mode", options.mode);
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  params.set("limit", String(options.limit));

  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings?${params.toString()}`);
  if (!response.ok) {
    return { ok: false, error: "Could not load the catalog." };
  }

  const result = publicListingSchema.array().safeParse(await response.json());
  if (!result.success) {
    return { ok: false, error: "The catalog response was invalid." };
  }

  const nextCursor = response.headers.get("X-Next-Cursor");
  return { ok: true, listings: result.data, nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : null };
}
