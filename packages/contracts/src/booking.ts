import { z } from "zod";

/**
 * `docs/cards/D059.md` — service booking creation. Mirrors
 * `packages/db/src/services/BookingService.ts`'s `CreateServiceBookingInput`.
 * `idempotencyKey` is required, not optional — this card's security check:
 * every booking-creation caller must supply an `Idempotency-Key`.
 */
export const createServiceBookingInputSchema = z.object({
  resourceId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});
export type CreateServiceBookingInput = z.infer<typeof createServiceBookingInputSchema>;
