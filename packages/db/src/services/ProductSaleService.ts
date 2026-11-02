import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { InventoryMovementRepository } from "../repositories/InventoryMovementRepository.js";
import type { Reservation, ReservationRepository } from "../repositories/ReservationRepository.js";
import type { VariantRepository } from "../repositories/VariantRepository.js";
import type { InventoryUnitService } from "./InventoryUnitService.js";

/**
 * `docs/cards/D067.md` — invariant I3. Thrown when the caller tries to sell
 * a serialized unit that currently has a blocking reservation (rented out
 * right now) covering the sale's `occurredAt` instant.
 */
export class UnitCurrentlyRentedError extends Error {
  constructor(public readonly unitId: string) {
    super(`Cannot sell unit ${unitId}: it is currently rented`);
    this.name = "UnitCurrentlyRentedError";
  }
}

/**
 * `docs/cards/D069.md` — thrown when a unit has one or more still-blocking
 * reservations that start *after* the sale's `occurredAt` (future bookings,
 * distinct from I3's "rented right now" check) and the caller did not pass
 * `overrideFutureReservations`. This is the "warn" half of the card's "warn,
 * require explicit override" deliverable — the sale makes no writes.
 */
export class FutureReservationsExistError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly reservationIds: string[],
  ) {
    super(
      `Cannot sell unit ${unitId}: it has ${reservationIds.length} future reservation(s); ` +
        "pass overrideFutureReservations to cancel them and proceed",
    );
    this.name = "FutureReservationsExistError";
  }
}

/** `docs/cards/D069.md` security check — override must carry a reason to be audit-logged. */
export class MissingOverrideReasonError extends Error {
  constructor() {
    super("overrideReason is required when overrideFutureReservations is true");
    this.name = "MissingOverrideReasonError";
  }
}

/**
 * `docs/cards/D069.md` deliverable — "notify customers". Same optional,
 * default-no-op injected-callback shape as the native auth provider's
 * password-reset notifier (`ResetTokenNotifier`, `apps/api/src/auth`): this
 * service has no opinion on the actual delivery channel (email/SMS/etc.),
 * it just guarantees the callback fires once per cancelled reservation with
 * the override reason.
 */
export type FutureReservationCancelledNotifier = (reservation: Reservation, reason: string) => void;

export interface SellProductInput {
  variantId: string;
  unitId?: string;
  locationId: string;
  quantity: number;
  note: string;
  actorUserId: string;
  occurredAt: string;
  /** `docs/cards/D069.md` — required explicit acknowledgement to sell a unit with future reservations. */
  overrideFutureReservations?: boolean;
  /** `docs/cards/D069.md` security check — required whenever `overrideFutureReservations` is true. */
  overrideReason?: string;
}

export interface SellProductResult {
  movementId: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
}

/**
 * This card's security check (`docs/design/07`): a sale's price never comes
 * from the caller. `SellProductInput` has no price field at all, so a
 * conforming caller cannot supply one — but a raw/untyped payload (a real
 * HTTP body) can still carry extra keys past the type system, so this
 * service reads price exclusively from `VariantRepository.findById`'s
 * `priceMinor`/`currency`, the server's own record, and never inspects the
 * input object for anything price-shaped. `lineTotalMinor` is computed here
 * from that server price times quantity, matching `CLAUDE.md`'s "prices and
 * totals are always recomputed server-side" rule.
 */
export class ProductSaleService {
  constructor(
    private readonly variantRepo: VariantRepository,
    private readonly movementRepo: InventoryMovementRepository,
    private readonly unitService: InventoryUnitService,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly reservationRepo: ReservationRepository,
    private readonly notifyFutureReservationCancelled: FutureReservationCancelledNotifier = () => undefined,
  ) {}

  sellProduct(ctx: TenantContext, actingRole: MerchantUserRole, input: SellProductInput): SellProductResult {
    assertCan({ role: actingRole }, "inventory:manage");

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error(`Sale quantity must be a positive integer, got: ${input.quantity}`);
    }

    const variant = this.variantRepo.findById(ctx, input.variantId);
    if (!variant) {
      throw new Error(`Variant not found: ${input.variantId}`);
    }
    if (variant.mode !== "PRODUCT") {
      throw new Error(`Cannot sell variant ${input.variantId}: mode is ${variant.mode}, not PRODUCT`);
    }

    let futureReservations: Reservation[] = [];
    if (input.unitId) {
      if (this.reservationRepo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", input.unitId, input.occurredAt)) {
        throw new UnitCurrentlyRentedError(input.unitId);
      }

      futureReservations = this.reservationRepo.findFutureBlocking(
        ctx,
        "INVENTORY_UNIT",
        input.unitId,
        input.occurredAt,
      );
      if (futureReservations.length > 0) {
        if (!input.overrideFutureReservations) {
          throw new FutureReservationsExistError(
            input.unitId,
            futureReservations.map((r) => r.id),
          );
        }
        if (!input.overrideReason || input.overrideReason.trim().length === 0) {
          throw new MissingOverrideReasonError();
        }
      }
    }

    const unitPriceMinor = variant.priceMinor;
    const currency = variant.currency;
    const lineTotalMinor = unitPriceMinor * input.quantity;

    const movementId = this.movementRepo.guardedDecrement(ctx, {
      variantId: input.variantId,
      unitId: input.unitId,
      locationId: input.locationId,
      kind: "SALE",
      quantity: input.quantity,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
      note: input.note,
    });

    if (input.unitId) {
      this.unitService.transitionStatus(ctx, actingRole, {
        unitId: input.unitId,
        newStatus: "SOLD",
        actorUserId: input.actorUserId,
        note: input.note,
        occurredAt: input.occurredAt,
      });
    }

    this.auditLogRepo.append(ctx, {
      actorType: "USER",
      actorId: input.actorUserId,
      action: "inventory.sale",
      entityType: "inventory_movements",
      entityId: movementId,
      afterJson: JSON.stringify({
        variantId: input.variantId,
        locationId: input.locationId,
        quantity: input.quantity,
        unitPriceMinor,
        lineTotalMinor,
        currency,
        note: input.note,
      }),
      occurredAt: input.occurredAt,
    });

    if (futureReservations.length > 0 && input.unitId) {
      for (const reservation of futureReservations) {
        this.reservationRepo.cancel(ctx, reservation.id, input.occurredAt);
        this.notifyFutureReservationCancelled(reservation, input.overrideReason as string);
      }

      // `docs/cards/D069.md` security check — the override itself is
      // audit-logged with actor and reason, distinct from the `inventory.sale`
      // entry above so "why were these bookings cancelled" is never buried
      // inside a plain sale record.
      this.auditLogRepo.append(ctx, {
        actorType: "USER",
        actorId: input.actorUserId,
        action: "inventory.sale.override_future_reservations",
        entityType: "inventory_units",
        entityId: input.unitId,
        afterJson: JSON.stringify({
          reason: input.overrideReason,
          cancelledReservationIds: futureReservations.map((r) => r.id),
        }),
        occurredAt: input.occurredAt,
      });
    }

    return { movementId, unitPriceMinor, lineTotalMinor, currency };
  }
}
