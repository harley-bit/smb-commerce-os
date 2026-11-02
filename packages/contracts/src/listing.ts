import { z } from "zod";

/**
 * `docs/design/03` "Catalog" — the same three-value discriminator as
 * `packages/db/src/schema/sqlite.ts`'s `listings.mode` and
 * `listing_variants.mode`. Defined once here so listing and variant
 * schemas (and any future consumer — web, mobile, the API layer) always
 * validate against the identical enum, never a hand-copied string union.
 */
export const listingModeSchema = z.enum(["PRODUCT", "SERVICE", "RENTAL"]);
export type ListingMode = z.infer<typeof listingModeSchema>;

export const listingStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

/**
 * Mirrors `packages/db/src/repositories/ListingRepository.ts`'s `Listing`
 * row shape — the full row as read back from the database.
 */
export const listingSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  mode: listingModeSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  status: listingStatusSchema,
  createdAt: z.string().min(1),
  archivedAt: z.string().nullable(),
});
export type Listing = z.infer<typeof listingSchema>;

/**
 * Mirrors `CreateListingInput`. `mode` is required and caller-supplied —
 * unlike `UpdateListingInput`, mode has not been fixed yet at create time.
 */
export const createListingInputSchema = z.object({
  mode: listingModeSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  status: listingStatusSchema,
  createdAt: z.string().min(1),
});
export type CreateListingInput = z.infer<typeof createListingInputSchema>;

/**
 * Mirrors `UpdateListingInput`. `docs/design/03`: "`mode` is immutable
 * after creation." `.strict()` makes that a runtime guarantee, not just a
 * compile-time one — a patch object carrying an extra `mode` key (e.g.
 * deserialized from a client payload with no static type checking it) is
 * rejected here, the same rule `ListingService.update`'s
 * `assertModeUnchanged` enforces on the server. One rule, checked at the
 * contract boundary and again at the service boundary.
 */
export const updateListingInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    status: listingStatusSchema.optional(),
  })
  .strict();
export type UpdateListingInput = z.infer<typeof updateListingInputSchema>;
