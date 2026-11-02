import { z } from "zod";

/**
 * `docs/design/03` "Locations". Mirrors
 * `packages/db/src/repositories/LocationRepository.ts`'s `Location` row
 * shape — `timezone` is the IANA zone name `AvailabilityService` resolves
 * every one of its resources' weekly rules against (`docs/cards/D112.md`).
 */
export const locationSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type Location = z.infer<typeof locationSchema>;
