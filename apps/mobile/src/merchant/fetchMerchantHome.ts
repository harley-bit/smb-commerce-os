import type { PublicMerchantProfile } from "@smb-os/contracts";
import { parseMerchantProfile } from "../shell/parseMerchantProfile";

export interface FetchMerchantHomeDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchMerchantHomeResult = { ok: true; profile: PublicMerchantProfile } | { ok: false; error: string };

/**
 * The `Home` screen's profile fetch — the same unauthenticated `GET
 * /v1/m/{slug}` call `apps/web/src/app/m/[slug]/MerchantPageView.tsx`
 * makes, with `fetchFn` injected (this codebase's DI convention for
 * network seams — see `../auth/authClient.ts`) so this is unit-testable
 * without a real server, and the payload validated against
 * `@smb-os/contracts`'s shared schema rather than trusted as-is.
 *
 * `docs/cards/D140.md` originally had this function fetch the merchant's
 * *entire* catalog alongside the profile, in one unbounded `GET
 * /v1/m/{slug}/listings` call. `docs/cards/D141.md` (catalog browse with
 * filters and cursor pagination) replaced that with `./fetchCatalogPage.ts`,
 * called separately by `HomeScreen` per filter/page — an unbounded fetch of
 * the whole catalog is exactly what cursor pagination exists to avoid, so
 * this function no longer does it.
 */
export async function fetchMerchantHome(deps: FetchMerchantHomeDeps, slug: string): Promise<FetchMerchantHomeResult> {
  const profileResponse = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}`);

  if (!profileResponse.ok) {
    return { ok: false, error: "Could not find that merchant." };
  }
  const parsedProfile = parseMerchantProfile(await profileResponse.json());
  if (!parsedProfile.ok) {
    return { ok: false, error: "The merchant profile response was invalid." };
  }

  return { ok: true, profile: parsedProfile.profile };
}
