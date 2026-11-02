import { z } from "zod";
import { listingModeSchema } from "./listing.js";
import { variantRatePeriodSchema } from "./variant.js";

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

/**
 * `docs/cards/D122.md`'s security check: stock is never exposed as the raw
 * count `packages/db/src/repositories/InventoryMovementRepository.ts`'s
 * `sumStock` computes — a competitor could otherwise read exact
 * quantities off a public page. Only this bucket ever leaves the server,
 * same posture as `InventoryUnitService`'s merchant-facing `RentalStatus`
 * enum (`packages/db/src/services/InventoryUnitService.ts`).
 */
export const publicStockStatusSchema = z.enum(["IN_STOCK", "OUT_OF_STOCK"]);
export type PublicStockStatus = z.infer<typeof publicStockStatusSchema>;

/**
 * The public read of `packages/db/src/repositories/VariantRepository.ts`'s
 * `Variant` — `merchantId`/`listingId` dropped (the caller already scoped
 * by listing), mode-specific service/rental fields dropped (this schema is
 * PRODUCT-only, D122's scope), and the raw stock number replaced by
 * `stockStatus` above.
 */
export const publicVariantSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  priceMinor: z.number().int(),
  currency: z.string().min(1),
  attributesJson: z.string().nullable(),
  stockStatus: publicStockStatusSchema,
});
export type PublicVariant = z.infer<typeof publicVariantSchema>;

/**
 * `docs/cards/D122.md`'s deliverable — a product listing plus its
 * variants, each carrying a bucketed stock status instead of a count.
 */
export const publicProductDetailSchema = publicListingSchema.extend({
  variants: z.array(publicVariantSchema),
});
export type PublicProductDetail = z.infer<typeof publicProductDetailSchema>;

/**
 * `docs/cards/D123.md`'s deliverable — a service listing plus the
 * `resource_id`s (`packages/db/src/repositories/ListingResourceRepository.ts`'s
 * `listing_resources` join) it can be booked against. `resourceId` is
 * already public today (`GET /v1/m/{slug}/availability?resourceId=...`,
 * `apps/api/src/routes/availability.ts`), so surfacing it here adds no new
 * exposure — it's what the storefront slot picker needs to call that
 * endpoint. This schema carries no reservation/booking data of its own;
 * that endpoint's `free: Interval[]` response is this card's security
 * check answered — bare free/busy intervals, never who booked.
 */
export const publicServiceDetailSchema = publicListingSchema.extend({
  resourceIds: z.array(z.string().min(1)),
});
export type PublicServiceDetail = z.infer<typeof publicServiceDetailSchema>;

/**
 * `docs/cards/D124.md`'s deposit-disclosure acceptance criterion, answered
 * at the schema level: `depositMinor` is a required field on every rental
 * variant a storefront visitor can see, not an optional add-on fetched
 * later — there is no code path that renders a rental variant without it.
 * No unit id/count/`inventory_units` data is exposed here (same posture as
 * `publicVariantSchema`'s bucketed `stockStatus` for PRODUCT) — a rental
 * listing's date-range availability is answered by a dedicated boolean
 * endpoint (`rentalAvailabilityResponseSchema` below), never by exposing
 * how many units exist.
 */
export const publicRentalVariantSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  priceMinor: z.number().int(),
  currency: z.string().min(1),
  ratePeriod: variantRatePeriodSchema.nullable(),
  depositMinor: z.number().int().nullable(),
});
export type PublicRentalVariant = z.infer<typeof publicRentalVariantSchema>;

/**
 * `docs/cards/D124.md`'s deliverable — a rental listing plus its variants,
 * each carrying the rate/deposit a storefront visitor needs to see before
 * ever picking a date range.
 */
export const publicRentalDetailSchema = publicListingSchema.extend({
  variants: z.array(publicRentalVariantSchema),
});
export type PublicRentalDetail = z.infer<typeof publicRentalDetailSchema>;

/**
 * `GET /v1/m/{slug}/listings/{listingSlug}/rental-availability`'s response
 * — a bare boolean, computed the same way
 * `RentalReservationService.createRentalReservation` narrows candidates
 * (`packages/db/src/services/RentalReservationService.ts`): does at least
 * one `AVAILABLE` unit for this variant have no blocking reservation over
 * `[from, to)`. Never exposes unit ids, unit count, or which unit(s) are
 * free — this card's "unavailable ranges blocked" acceptance criterion only
 * needs a yes/no per candidate range.
 */
export const rentalAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});
export type RentalAvailabilityResponse = z.infer<typeof rentalAvailabilityResponseSchema>;
