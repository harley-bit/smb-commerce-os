import { z } from "zod";
import { listingModeSchema } from "./listing.js";

/**
 * `docs/design/06`'s public storefront surface (`GET /v1/m/{merchantSlug}`)
 * — a deliberately narrower view than `MerchantRepository`'s `Merchant`
 * row: no internal `id`, no `connectAccountId`, no legal/tax/address
 * fields. A storefront visitor identifies the merchant by `slug` (already
 * in the URL) and never needs the DB-internal id (this card's security
 * check).
 */
export const publicMerchantProfileSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  defaultCurrency: z.string().min(1),
});
export type PublicMerchantProfile = z.infer<typeof publicMerchantProfileSchema>;

/**
 * `docs/design/06`'s "mixed catalog, filter by mode" — the public read
 * of `packages/db/src/repositories/ListingRepository.ts`'s `Listing`, with
 * `merchantId` (the caller already scoped by slug), `status`, `createdAt`,
 * and `archivedAt` dropped: a storefront visitor never sees anything but
 * `PUBLISHED` listings (enforced server-side by `ListingService.listPublished`),
 * so a status/lifecycle field would only ever say one thing and would leak
 * that a draft/archived catalog exists at all.
 */
export const publicListingSchema = z.object({
  id: z.string().min(1),
  mode: listingModeSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
});
export type PublicListing = z.infer<typeof publicListingSchema>;
