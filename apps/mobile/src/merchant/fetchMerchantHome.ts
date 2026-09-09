import { publicListingSchema, type PublicListing, type PublicMerchantProfile } from "@smb-os/contracts";
import { parseMerchantProfile } from "../shell/parseMerchantProfile";

export interface FetchMerchantHomeDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
}

export type FetchMerchantHomeResult =
  | { ok: true; profile: PublicMerchantProfile; listings: PublicListing[] }
  | { ok: false; error: string };

/**
 * The `Home` screen's data fetch (`docs/cards/D140.md`) — the same two
 * unauthenticated `GET /v1/m/{slug}` + `GET /v1/m/{slug}/listings` calls
 * `apps/web/src/app/m/[slug]/MerchantPageView.tsx` makes, run in parallel
 * the same way, but with `fetchFn` injected (this codebase's DI convention
 * for network seams — see `../auth/authClient.ts`) so this is unit-testable
 * without a real server, and both payloads validated against
 * `@smb-os/contracts`'s shared schemas rather than trusted as-is.
 *
 * A failed listings call degrades to an empty catalog rather than failing
 * the whole screen — the merchant profile is still valid, and `HomeScreen`
 * already renders "Nothing here yet." per empty mode section.
 */
export async function fetchMerchantHome(deps: FetchMerchantHomeDeps, slug: string): Promise<FetchMerchantHomeResult> {
  const [profileResponse, listingsResponse] = await Promise.all([
    deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}`),
    deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/listings`),
  ]);

  if (!profileResponse.ok) {
    return { ok: false, error: "Could not find that merchant." };
  }
  const parsedProfile = parseMerchantProfile(await profileResponse.json());
  if (!parsedProfile.ok) {
    return { ok: false, error: "The merchant profile response was invalid." };
  }

  if (!listingsResponse.ok) {
    return { ok: true, profile: parsedProfile.profile, listings: [] };
  }
  const listingsResult = publicListingSchema.array().safeParse(await listingsResponse.json());
  const listings = listingsResult.success ? listingsResult.data : [];

  return { ok: true, profile: parsedProfile.profile, listings };
}
