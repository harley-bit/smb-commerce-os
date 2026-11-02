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
  /** `docs/cards/D062.md` — the identity the concurrent-hold cap is enforced against. Undefined means anonymous. */
  createdByAccountId?: string;
  createdByIp?: string;
}

const DEFAULT_HOLD_MINUTES = 15;

/**
 * `docs/design/07`/`14` T10 "Hold exhaustion" — an attacker or a bug
 * reserving every slot without paying. Three independent caps, all
 * evaluated against the same lazy-expiry count `ReservationRepository`
 * already uses for overlap checks (`state = 'HELD' AND expires_at > asOf`),
 * so a cap frees up the instant a hold expires with no sweeper dependency:
 * `perAccountLimit` for an authenticated caller's own concurrent holds,
 * `perIpLimit` as a looser shared ceiling per source IP, and the stricter
 * `anonymousLimit` applied by IP alone when there is no account id at all
 * (`docs/design/07` "Anonymous carts get a stricter concurrent-hold cap
 * than authenticated ones").
 */
export interface HoldCapConfig {
  perAccountLimit: number;
  perIpLimit: number;
  anonymousLimit: number;
}

export const DEFAULT_HOLD_CAPS: HoldCapConfig = {
  perAccountLimit: 5,
  perIpLimit: 20,
  anonymousLimit: 3,
};

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key is required to create a booking");
    this.name = "MissingIdempotencyKeyError";
  }
}

/** `docs/cards/D062.md` — thrown when a caller is at its concurrent-hold cap. */
export class HoldLimitExceededError extends Error {
  constructor() {
    super("Too many concurrent holds — release or confirm an existing hold before creating another.");
    this.name = "HoldLimitExceededError";
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
    private readonly holdCaps: HoldCapConfig = DEFAULT_HOLD_CAPS,
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

    this.assertUnderHoldCap(ctx, input);

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
        createdByAccountId: input.createdByAccountId,
        createdByIp: input.createdByIp,
      },
      resource.capacity,
    );
  }

  /**
   * `docs/cards/D127.md` — `confirmedAt` is the "payment time" instant this
   * confirmation happens at; passed through unconditionally to
   * `ReservationRepository.confirm` so an unswept expired `HELD` reservation
   * throws `HoldExpiredError` here instead of being silently confirmed
   * (this card's security check).
   */
  confirmServiceBooking(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    reservationId: string,
    confirmedAt: string,
  ): void {
    assertCan({ role: actingRole }, "bookings:manage");
    this.reservations.confirm(ctx, reservationId, confirmedAt);
  }

  private assertUnderHoldCap(ctx: TenantContext, input: CreateServiceBookingInput): void {
    const asOf = input.createdAt;

    if (input.createdByAccountId) {
      const accountHolds = this.reservations.countActiveHoldsByAccount(ctx, input.createdByAccountId, asOf);
      if (accountHolds >= this.holdCaps.perAccountLimit) {
        throw new HoldLimitExceededError();
      }
    }

    if (input.createdByIp) {
      const ipLimit = input.createdByAccountId ? this.holdCaps.perIpLimit : this.holdCaps.anonymousLimit;
      const ipHolds = this.reservations.countActiveHoldsByIp(ctx, input.createdByIp, asOf);
      if (ipHolds >= ipLimit) {
        throw new HoldLimitExceededError();
      }
    }
  }
}
