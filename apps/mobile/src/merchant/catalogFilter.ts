import type { ListingMode } from "@smb-os/contracts";

/** `ALL` has no server-side `mode` equivalent — see `filterToMode` below. */
export type CatalogFilter = "ALL" | ListingMode;

/** Same three modes/order the web storefront's `MerchantPageView.tsx` sections use, plus an `ALL` tab first. */
export const CATALOG_FILTERS: ReadonlyArray<{ filter: CatalogFilter; label: string }> = [
  { filter: "ALL", label: "All" },
  { filter: "PRODUCT", label: "Products" },
  { filter: "SERVICE", label: "Services" },
  { filter: "RENTAL", label: "Rentals" },
];

/** `undefined` means "no mode filter" to `GET /v1/m/{slug}/listings`'s `?mode=` query parameter. */
export function filterToMode(filter: CatalogFilter): ListingMode | undefined {
  return filter === "ALL" ? undefined : filter;
}
