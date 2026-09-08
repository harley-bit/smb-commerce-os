import {
  assertCan,
  selectUnitForAllocation,
  type AllocationCandidate,
  type TenantContext,
} from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";
import type { VariantRepository } from "../repositories/VariantRepository.js";

export interface CreateRentalReservationInput {
  variantId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  /** `docs/cards/D066.md` security check — required, not optional. */
  idempotencyKey: string;
  /** `docs/design/05` "Default 15 minutes; configurable per merchant." Defaults below if omitted. */
  expiresAt?: string;
  createdByAccountId?: string;
  createdByIp?: string;
}

const DEFAULT_HOLD_MINUTES = 15;

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key is required to create a rental reservation");
    this.name = "MissingIdempotencyKeyError";
  }
}

export class VariantNotRentalError extends Error {
  constructor(public readonly variantId: string) {
    super(`Variant is not a RENTAL-mode variant: ${variantId}`);
    this.name = "VariantNotRentalError";
  }
}

/**
 * `docs/cards/D066.md` — rental reservation creation, the HELD flow for
 * `RENTAL`-mode listings. Rental assets are always serialized
 * (`docs/design/05` line 96), so unlike `BookingService`'s `RESOURCE`
 * subject (fixed ahead of time by the caller), this service must *pick*
 * which `inventory_units` row to reserve: narrow the variant's `AVAILABLE`
 * units down to ones with no blocking reservation over the requested
 * interval (`ReservationRepository.findBlocking`), then hand the free set to
 * D065's `selectUnitForAllocation` for the least-recently-returned-first
 * pick. The chosen unit becomes the reservation's `subjectId` and the
 * booking itself is written through `ReservationRepository.createGuarded`
 * (D050/D064), the same guarded, buffer-expanding, idempotent write path
 * every other reservation subject uses — `selectUnitForAllocation` throwing
 * `NoAvailableUnitError` on an empty candidate set is what satisfies this
 * card's "conflict rejected" acceptance criterion when every unit is
 * occupied for the requested window.
 *
 * Authorization reuses `bookings:manage` (same RBAC action as
 * `BookingService` — a rental reservation is an operational booking, not a
 * catalog-management action).
 */
export class RentalReservationService {
  constructor(
    private readonly variants: VariantRepository,
    private readonly inventoryUnits: InventoryUnitRepository,
    private readonly reservations: ReservationRepository,
  ) {}

  createRentalReservation(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: CreateRentalReservationInput,
  ): string {
    assertCan({ role: actingRole }, "bookings:manage");

    if (!input.idempotencyKey) {
      throw new MissingIdempotencyKeyError();
    }

    const variant = this.variants.findById(ctx, input.variantId);
    if (!variant) {
      throw new Error(`Variant not found: ${input.variantId}`);
    }
    if (variant.mode !== "RENTAL") {
      throw new VariantNotRentalError(input.variantId);
    }

    // `docs/cards/D068.md` invariant I4: SOLD/RETIRED (and MAINTENANCE/LOST)
    // units are excluded here, so a variant with zero AVAILABLE units left
    // falls through to `selectUnitForAllocation`'s `NoAvailableUnitError`
    // below — the same rejection path as a pure scheduling conflict.
    const candidates: AllocationCandidate[] = this.inventoryUnits
      .listByVariant(ctx, input.variantId)
      .filter((unit) => unit.status === "AVAILABLE")
      .filter(
        (unit) =>
          this.reservations.findBlocking(
            ctx,
            "INVENTORY_UNIT",
            unit.id,
            input.startsAt,
            input.endsAt,
            input.createdAt,
          ).length === 0,
      )
      .map((unit) => ({
        unitId: unit.id,
        lastReturnedAt: this.reservations.lastReturnedAt(ctx, "INVENTORY_UNIT", unit.id),
      }));

    const selected = selectUnitForAllocation(candidates);

    const expiresAt =
      input.expiresAt ?? new Date(new Date(input.createdAt).getTime() + DEFAULT_HOLD_MINUTES * 60_000).toISOString();

    return this.reservations.createGuarded(
      ctx,
      {
        subjectType: "INVENTORY_UNIT",
        subjectId: selected.unitId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        quantity: 1,
        state: "HELD",
        createdAt: input.createdAt,
        expiresAt,
        idempotencyKey: input.idempotencyKey,
        createdByAccountId: input.createdByAccountId,
        createdByIp: input.createdByIp,
        bufferMinutes: variant.bufferMinutes,
      },
      1,
    );
  }
}
