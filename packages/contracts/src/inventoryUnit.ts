import { z } from "zod";

export const inventoryUnitTrackingModeSchema = z.enum(["SERIALIZED", "FUNGIBLE"]);
export type InventoryUnitTrackingMode = z.infer<typeof inventoryUnitTrackingModeSchema>;

export const inventoryUnitStatusSchema = z.enum(["AVAILABLE", "SOLD", "MAINTENANCE", "RETIRED", "LOST"]);
export type InventoryUnitStatus = z.infer<typeof inventoryUnitStatusSchema>;

/**
 * `docs/design/03` line 89: "`acquisition_cost_minor`, `acquired_at`,
 * `expected_life_months` are captured for utilization analysis. Cheap now,
 * impossible to backfill." `packages/db`'s `CreateInventoryUnitInput`
 * leaves these optional (so the dozens of pre-D110 fixtures that create a
 * bare unit for another test's setup didn't need touching), but this
 * contract — the boundary a real merchant-facing create form must pass
 * through — makes `acquisitionCostMinor`/`acquiredAt` mandatory, the same
 * "stricter at the contract than at the column" pattern D103's
 * `onboardMerchantInputSchema` already established for seller identity.
 */
export const createInventoryUnitInputSchema = z.object({
  variantId: z.string().min(1),
  locationId: z.string().min(1),
  unitCode: z.string().min(1),
  trackingMode: inventoryUnitTrackingModeSchema,
  acquisitionCostMinor: z.number().int().nonnegative(),
  acquiredAt: z.string().min(1),
  expectedLifeMonths: z.number().int().positive().optional(),
  conditionGrade: z.string().min(1).optional(),
});
export type CreateInventoryUnitInput = z.infer<typeof createInventoryUnitInputSchema>;

/**
 * Deliberately excludes `acquisitionCostMinor`/`acquiredAt` (and `status`,
 * `variantId`, `trackingMode`) — `.strict()` rejects a body carrying any of
 * them outright, mirroring `updateVariantInputSchema`'s shape. Acquisition
 * data is captured once, at creation, or not at all (this card's security
 * check); a status change goes through `InventoryUnitService.transitionStatus`
 * instead, not this schema.
 */
export const updateInventoryUnitInputSchema = z
  .object({
    unitCode: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    expectedLifeMonths: z.number().int().positive().optional(),
    conditionGrade: z.string().min(1).optional(),
  })
  .strict();
export type UpdateInventoryUnitInput = z.infer<typeof updateInventoryUnitInputSchema>;

export const inventoryUnitSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  variantId: z.string().min(1),
  locationId: z.string().min(1),
  unitCode: z.string().min(1),
  trackingMode: inventoryUnitTrackingModeSchema,
  status: inventoryUnitStatusSchema,
  acquisitionCostMinor: z.number().int().nullable(),
  acquiredAt: z.string().nullable(),
  expectedLifeMonths: z.number().int().nullable(),
  conditionGrade: z.string().nullable(),
  retiredAt: z.string().nullable(),
});
export type InventoryUnitRecord = z.infer<typeof inventoryUnitSchema>;

/**
 * `docs/cards/D111.md` — computed fresh on every `GET .../units` read from
 * the unit's currently-blocking reservation (`InventoryUnitService.listWithRentalStatus`),
 * never persisted on the unit row itself. `GET .../units`'s real response
 * shape, distinct from `inventoryUnitSchema` above.
 */
export const rentalStatusSchema = z.enum(["AVAILABLE", "OUT_ON_RENTAL"]);
export type RentalStatus = z.infer<typeof rentalStatusSchema>;

export const inventoryUnitWithRentalStatusSchema = inventoryUnitSchema.extend({
  rentalStatus: rentalStatusSchema,
  returnDueAt: z.string().nullable(),
});
export type InventoryUnitWithRentalStatusRecord = z.infer<typeof inventoryUnitWithRentalStatusSchema>;
