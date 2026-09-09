import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import {
  type CreateInventoryUnitInput,
  type InventoryUnit,
  type InventoryUnitRepository,
  type InventoryUnitStatus,
  type UpdateInventoryUnitFields,
} from "../repositories/InventoryUnitRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";

export type RentalStatus = "AVAILABLE" | "OUT_ON_RENTAL";

/**
 * `docs/cards/D111.md` deliverable — a unit's own `status` column stays
 * `AVAILABLE` for the whole life of a rental (`docs/design/05`/D065's log:
 * "currently rented" is derived from `reservations`, never stored on the
 * unit itself), so this view field is computed fresh on every read, not
 * persisted.
 */
export interface InventoryUnitWithRentalStatus extends InventoryUnit {
  rentalStatus: RentalStatus;
  returnDueAt: string | null;
}

export interface TransitionUnitStatusInput {
  unitId: string;
  newStatus: InventoryUnitStatus;
  actorUserId: string;
  note: string;
  occurredAt: string;
}

export class InvalidUnitStatusTransitionError extends Error {
  constructor(
    public readonly from: InventoryUnitStatus,
    public readonly to: InventoryUnitStatus,
  ) {
    super(`Cannot transition inventory unit from ${from} to ${to}`);
    this.name = "InvalidUnitStatusTransitionError";
  }
}

/**
 * `docs/design/03` "Inventory": `SOLD` and `RETIRED` are terminal — once a
 * unit reaches either, no further status transition is permitted (this
 * card's acceptance criterion). `LOST` can still be recovered (`AVAILABLE`)
 * or written off (`RETIRED`); `MAINTENANCE` always returns to `AVAILABLE`
 * or ends in `RETIRED`/`LOST`.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<InventoryUnitStatus, ReadonlySet<InventoryUnitStatus>>> = {
  AVAILABLE: new Set(["SOLD", "MAINTENANCE", "RETIRED", "LOST"]),
  MAINTENANCE: new Set(["AVAILABLE", "RETIRED", "LOST"]),
  LOST: new Set(["AVAILABLE", "RETIRED"]),
  SOLD: new Set(),
  RETIRED: new Set(),
};

function assertValidTransition(from: InventoryUnitStatus, to: InventoryUnitStatus): void {
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new InvalidUnitStatusTransitionError(from, to);
  }
}

/**
 * This card's security check: every unit status change is audit-logged.
 * `transitionStatus` appends a hash-chained `audit_log` entry (D030) with
 * the before/after status and the caller's reason, only after the state
 * machine has accepted the transition and the row has actually been
 * updated — a rejected transition writes nothing.
 */
export class InventoryUnitService {
  constructor(
    private readonly unitRepo: InventoryUnitRepository,
    private readonly auditLogRepo: AuditLogRepository,
    /**
     * Optional so every pre-existing call site (this card added no new
     * required dependency to a service already constructed in a dozen
     * places) keeps working unchanged; `listWithRentalStatus` is the only
     * method that needs it.
     */
    private readonly reservationRepo?: ReservationRepository,
  ) {}

  /**
   * `docs/design/03` line 89: acquisition data ("cheap now, impossible to
   * backfill") is only ever written here, at creation — `update` below can
   * never touch it.
   */
  create(ctx: TenantContext, actingRole: MerchantUserRole, input: CreateInventoryUnitInput): string {
    assertCan({ role: actingRole }, "inventory:manage");
    return this.unitRepo.create(ctx, input);
  }

  /**
   * Deliberately typed against `UpdateInventoryUnitFields`, which has no
   * `acquisitionCostMinor`/`acquiredAt`/`status` member — this card's
   * security check is enforced at the type level here and again at the
   * HTTP contract boundary (`updateInventoryUnitInputSchema`'s `.strict()`),
   * not by a runtime check in this method.
   */
  update(ctx: TenantContext, actingRole: MerchantUserRole, unitId: string, patch: UpdateInventoryUnitFields): void {
    assertCan({ role: actingRole }, "inventory:manage");

    const unit = this.unitRepo.findById(ctx, unitId);
    if (!unit) {
      throw new Error(`Inventory unit not found: ${unitId}`);
    }

    this.unitRepo.update(ctx, unitId, patch);
  }

  /**
   * `docs/cards/D111.md` — "unit list shows out-on-rental with return
   * date," this card's deliverable, and "a rented unit is visibly
   * unavailable for sale," its acceptance criterion. Looks up each unit's
   * currently-blocking reservation (`ReservationRepository.findActiveBlocking`
   * — the same `CONFIRMED`/`IN_USE`/unexpired-`HELD` predicate that already
   * enforces invariant I3 on the sale path, D067) and surfaces its `endsAt`
   * as `returnDueAt`. A unit's own `status` is left untouched — this is a
   * read-side view, not a status transition.
   */
  listWithRentalStatus(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    variantId: string,
    asOf: string,
  ): InventoryUnitWithRentalStatus[] {
    assertCan({ role: actingRole }, "inventory:view");

    const units = this.unitRepo.listByVariant(ctx, variantId);
    if (!this.reservationRepo) {
      return units.map((unit) => ({ ...unit, rentalStatus: "AVAILABLE" as const, returnDueAt: null }));
    }

    return units.map((unit) => {
      const active = this.reservationRepo!.findActiveBlocking(ctx, "INVENTORY_UNIT", unit.id, asOf);
      return active
        ? { ...unit, rentalStatus: "OUT_ON_RENTAL" as const, returnDueAt: active.endsAt }
        : { ...unit, rentalStatus: "AVAILABLE" as const, returnDueAt: null };
    });
  }

  transitionStatus(ctx: TenantContext, actingRole: MerchantUserRole, input: TransitionUnitStatusInput): void {
    assertCan({ role: actingRole }, "inventory:manage");

    const unit = this.unitRepo.findById(ctx, input.unitId);
    if (!unit) {
      throw new Error(`Inventory unit not found: ${input.unitId}`);
    }

    assertValidTransition(unit.status, input.newStatus);

    this.unitRepo.updateStatus(ctx, input.unitId, input.newStatus, input.occurredAt);

    this.auditLogRepo.append(ctx, {
      actorType: "USER",
      actorId: input.actorUserId,
      action: "inventory_unit.status_changed",
      entityType: "inventory_units",
      entityId: input.unitId,
      beforeJson: JSON.stringify({ status: unit.status }),
      afterJson: JSON.stringify({ status: input.newStatus, note: input.note }),
      occurredAt: input.occurredAt,
    });
  }
}
