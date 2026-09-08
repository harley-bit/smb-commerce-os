import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import {
  type InventoryUnitRepository,
  type InventoryUnitStatus,
} from "../repositories/InventoryUnitRepository.js";

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
  ) {}

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
