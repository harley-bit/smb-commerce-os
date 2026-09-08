import { z } from "zod";

/**
 * `docs/design/03` "Service capacity". Mirrors
 * `packages/db/src/schema/sqlite.ts`'s `resources.kind` enum.
 */
export const resourceKindSchema = z.enum(["STAFF", "ROOM", "EQUIPMENT"]);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

/** Mirrors `packages/db/src/repositories/ResourceRepository.ts`'s `Resource` row shape. */
export const resourceSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  locationId: z.string().min(1),
  kind: resourceKindSchema,
  name: z.string().min(1),
  capacity: z.number().int().positive(),
  archivedAt: z.string().nullable(),
});
export type Resource = z.infer<typeof resourceSchema>;

export const createResourceInputSchema = z.object({
  locationId: z.string().min(1),
  kind: resourceKindSchema,
  name: z.string().min(1),
  capacity: z.number().int().positive(),
});
export type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

export const updateResourceInputSchema = z
  .object({
    locationId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    capacity: z.number().int().positive().optional(),
  })
  .strict();
export type UpdateResourceInput = z.infer<typeof updateResourceInputSchema>;

/**
 * `docs/design/03` "Service capacity" — recurring weekly availability,
 * deliberately weekday (0=Sunday..6=Saturday) + "HH:MM" time window rather
 * than a full RRULE. Mirrors
 * `packages/db/src/repositories/AvailabilityRuleRepository.ts`.
 */
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export const availabilityRuleSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  resourceId: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
});
export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

export const createAvailabilityRuleInputSchema = z.object({
  resourceId: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export type CreateAvailabilityRuleInput = z.infer<typeof createAvailabilityRuleInputSchema>;

export const updateAvailabilityRuleInputSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).optional(),
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .strict();
export type UpdateAvailabilityRuleInput = z.infer<typeof updateAvailabilityRuleInputSchema>;

/**
 * `docs/design/03` "Service capacity" — one-off deviations from the
 * recurring rule, bounded by a real UTC interval rather than a
 * weekday/time-of-day pair. Mirrors
 * `packages/db/src/repositories/AvailabilityExceptionRepository.ts`.
 */
export const availabilityExceptionKindSchema = z.enum(["BLACKOUT", "EXTRA"]);
export type AvailabilityExceptionKind = z.infer<typeof availabilityExceptionKindSchema>;

export const availabilityExceptionSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  resourceId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  kind: availabilityExceptionKindSchema,
  note: z.string().nullable(),
});
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

export const createAvailabilityExceptionInputSchema = z.object({
  resourceId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  kind: availabilityExceptionKindSchema,
  note: z.string().optional(),
});
export type CreateAvailabilityExceptionInput = z.infer<
  typeof createAvailabilityExceptionInputSchema
>;

export const updateAvailabilityExceptionInputSchema = z
  .object({
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).optional(),
    kind: availabilityExceptionKindSchema.optional(),
    note: z.string().nullable().optional(),
  })
  .strict();
export type UpdateAvailabilityExceptionInput = z.infer<
  typeof updateAvailabilityExceptionInputSchema
>;
