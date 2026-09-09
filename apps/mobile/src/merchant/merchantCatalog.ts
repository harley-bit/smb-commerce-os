import type { ListingMode, PublicListing } from "@smb-os/contracts";

export interface MerchantCatalogSection {
  mode: ListingMode;
  heading: string;
  listings: PublicListing[];
}

/**
 * Same three sections, same order, as `apps/web/src/app/m/[slug]/MerchantPageView.tsx`'s
 * `MODE_SECTIONS` — the web storefront's "all three modes, always present"
 * layout, kept here as the mobile app's one source of truth for it rather
 * than re-deriving the heading text at each call site.
 */
export const MODE_SECTIONS: ReadonlyArray<{ mode: ListingMode; heading: string }> = [
  { mode: "PRODUCT", heading: "Products" },
  { mode: "SERVICE", heading: "Services" },
  { mode: "RENTAL", heading: "Rentals" },
];

/** Buckets a mixed `GET /v1/m/{slug}/listings` catalog into one section per mode, in `MODE_SECTIONS` order. */
export function groupListingsByMode(listings: readonly PublicListing[]): MerchantCatalogSection[] {
  return MODE_SECTIONS.map(({ mode, heading }) => ({
    mode,
    heading,
    listings: listings.filter((listing) => listing.mode === mode),
  }));
}
