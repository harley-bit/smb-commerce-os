import { Money } from "@smb-os/domain";
import { z } from "zod";
import { listingModeSchema, type ListingMode } from "./listing.js";

export const variantModeSchema = listingModeSchema;
export type VariantMode = ListingMode;

export const variantRatePeriodSchema = z.enum(["HOUR", "DAY", "WEEK"]);
export type VariantRatePeriod = z.infer<typeof variantRatePeriodSchema>;

/**
 * `packages/db/src/schema/sqlite.ts`'s `listing_variants_mode_fields_check`
 * (`D022`/`D063`) and `packages/db/src/services/VariantService.ts`'s
 * `FORBIDDEN_FIELDS_BY_MODE` (`D033`/`D063`) both encode this same rule —
 * `durationMinutes` is services-only, `ratePeriod`/`depositMinor`/
 * `bufferMinutes` are rentals-only. Exported here as the one definition this
 * package's own create/update schemas validate against; a future card wiring
 * `VariantService` to import this instead of re-declaring its own copy
 * would remove that last duplicate (tracked, not done in this card — see
 * `docs/logs/D034.md`).
 */
export const FORBIDDEN_VARIANT_FIELDS_BY_MODE: Record<VariantMode, readonly string[]> = {
  PRODUCT: ["durationMinutes", "ratePeriod", "depositMinor", "bufferMinutes"],
  SERVICE: ["ratePeriod", "depositMinor", "bufferMinutes"],
  RENTAL: ["durationMinutes"],
};

/**
 * The single place `priceMinor`/`currency` is validated in this package —
 * both `createVariantInputSchema` and `updateVariantInputSchema` call this
 * same function via `superRefine`, and it in turn calls the exact
 * `Money.of` (`@smb-os/domain`) that `VariantService`'s own price
 * validation calls server-side. Non-integer minor units and an empty
 * currency code are rejected by the identical rule everywhere, not a
 * re-implementation of it.
 */
function assertValidMoney(
  priceMinor: number,
  currency: string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  try {
    Money.of(priceMinor, currency);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: (error as Error).message,
      path,
    });
  }
}

function assertFieldsAllowedForMode(
  mode: VariantMode,
  fields: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const field of FORBIDDEN_VARIANT_FIELDS_BY_MODE[mode]) {
    if (fields[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `${mode} variants cannot carry field forbidden by mode: ${field}`,
        path: [field],
      });
    }
  }
}

/**
 * Mirrors `packages/db/src/repositories/VariantRepository.ts`'s `Variant`
 * row shape — the full row as read back from the database.
 */
export const variantSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  listingId: z.string().min(1),
  mode: variantModeSchema,
  sku: z.string().min(1),
  name: z.string().min(1),
  attributesJson: z.string().nullable(),
  priceMinor: z.number(),
  currency: z.string().min(1),
  durationMinutes: z.number().nullable(),
  ratePeriod: variantRatePeriodSchema.nullable(),
  depositMinor: z.number().nullable(),
  bufferMinutes: z.number().nullable(),
  archivedAt: z.string().nullable(),
});
export type Variant = z.infer<typeof variantSchema>;

/**
 * Mirrors `CreateVariantInput`. Runs both of this package's shared
 * validation rules: the mode-conditional forbidden-fields check and the
 * `Money.of`-backed price check.
 */
export const createVariantInputSchema = z
  .object({
    listingId: z.string().min(1),
    mode: variantModeSchema,
    sku: z.string().min(1),
    name: z.string().min(1),
    attributesJson: z.string().optional(),
    priceMinor: z.number(),
    currency: z.string(),
    durationMinutes: z.number().optional(),
    ratePeriod: variantRatePeriodSchema.optional(),
    depositMinor: z.number().optional(),
    bufferMinutes: z.number().optional(),
  })
  .superRefine((input, ctx) => {
    assertValidMoney(input.priceMinor, input.currency, ctx, ["priceMinor"]);
    assertFieldsAllowedForMode(input.mode, input, ctx);
  });
export type CreateVariantInput = z.infer<typeof createVariantInputSchema>;

/**
 * Mirrors `UpdateVariantInput` — deliberately has no `mode`/`listingId`
 * field, same posture as the repository type: both are fixed at creation.
 * `.strict()` rejects a patch object carrying either key at runtime, not
 * just at the type level. Mode-conditional field validation against an
 * *existing* row's mode still needs that row (this schema has no way to
 * see it), so it stays `VariantService.update`'s job, same as today.
 */
export const updateVariantInputSchema = z
  .object({
    sku: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    attributesJson: z.string().optional(),
    priceMinor: z.number().optional(),
    currency: z.string().optional(),
    durationMinutes: z.number().optional(),
    ratePeriod: variantRatePeriodSchema.optional(),
    depositMinor: z.number().optional(),
    bufferMinutes: z.number().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.priceMinor !== undefined && input.currency !== undefined) {
      assertValidMoney(input.priceMinor, input.currency, ctx, ["priceMinor"]);
    }
  });
export type UpdateVariantInput = z.infer<typeof updateVariantInputSchema>;
