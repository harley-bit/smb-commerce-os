import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";
import type { ResourceRepository } from "../repositories/ResourceRepository.js";

export interface CreateServiceBookingInput {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  quantity: number;
  /** `docs/cards/D059.md` security check — required, not optional. */
  idempotencyKey: string;
  createdAt: string;
  /** `docs/design/05` "Default 15 minutes; configurable per merchant." Defaults below if omitted. */
  expiresAt?: string;
}

const DEFAULT_HOLD_MINUTES = 15;

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key is required to create a booking");
    this.name = "MissingIdempotencyKeyError";
  }
}

/**
 * `docs/cards/D059.md` — service booking creation, the HELD → CONFIRMED flow
 * for `SERVICE`-mode listings. A booking *is* a `reservations` row with
 * `subjectType: "RESOURCE"` (`ReservationRepository`, D050/D054); this
 * service is the SERVICE-mode-specific entry point over that generic
 * machinery, the same relationship `ProductSaleService` has to
 * `InventoryMovementRepository`.
 *
 * Authorization reuses the `bookings:manage` action already defined in
 * `packages/domain`'s RBAC matrix (`docs/design/07`) — OWNER/ADMIN/STAFF can
 * create and confirm bookings, READ_ONLY cannot. This is a different gate
 * than `ResourceService`'s `assertCanManageCatalog` (OWNER/ADMIN only,
 * D058): booking a resource is an operational action a STAFF member
 * routinely performs, not a catalog-management one.
 */
export class BookingService {
  constructor(
    private readonly resources: ResourceRepository,
    private readonly reservations: ReservationRepository,
  ) {}

  createServiceBooking(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: CreateServiceBookingInput,
  ): string {
    assertCan({ role: actingRole }, "bookings:manage");

    if (!input.idempotencyKey) {
      throw new MissingIdempotencyKeyError();
    }

    const resource = this.resources.findById(ctx, input.resourceId);
    if (!resource) {
      throw new Error(`Resource not found: ${input.resourceId}`);
    }

    const expiresAt =
      input.expiresAt ?? new Date(new Date(input.createdAt).getTime() + DEFAULT_HOLD_MINUTES * 60_000).toISOString();

    return this.reservations.createGuarded(
      ctx,
      {
        subjectType: "RESOURCE",
        subjectId: input.resourceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        quantity: input.quantity,
        state: "HELD",
        createdAt: input.createdAt,
        expiresAt,
        idempotencyKey: input.idempotencyKey,
      },
      resource.capacity,
    );
  }

  confirmServiceBooking(ctx: TenantContext, actingRole: MerchantUserRole, reservationId: string): void {
    assertCan({ role: actingRole }, "bookings:manage");
    this.reservations.confirm(ctx, reservationId);
  }
}
