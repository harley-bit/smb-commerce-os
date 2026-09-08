import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { InventoryMovementRepository } from "../repositories/InventoryMovementRepository.js";

export interface ReceiveStockInput {
  variantId: string;
  unitId?: string;
  locationId: string;
  quantity: number;
  note: string;
  actorUserId: string;
  occurredAt: string;
}

/**
 * This card's security check: every RECEIPT is audit-logged with its
 * reason, not just recorded in the ledger. `note` is required on the
 * `inventory_movements` row itself (schema-enforced, `docs/design/03`), and
 * this service additionally appends a hash-chained `audit_log` entry
 * (`AuditLogRepository`, D030) carrying the same reason in `afterJson`, so
 * "why was stock added" survives independently of the movement row and is
 * tamper-evident.
 */
function assertValidReceipt(quantity: number, note: string): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`RECEIPT quantity must be a positive integer, got: ${quantity}`);
  }
  if (note.trim().length === 0) {
    throw new Error("RECEIPT requires a non-blank note — every adjustment needs a reason");
  }
}

/**
 * `docs/design/03` "Inventory": stock is never a stored counter, always the
 * sum of the append-only `inventory_movements` ledger
 * (`InventoryMovementRepository.sumStock`). This service's only mutation
 * this card is `receiveStock` (`RECEIPT` movements); `assertCan` (D037)
 * gates it on `inventory:manage` before any write, same authorization
 * posture as `ListingService`/`VariantService`.
 */
export class InventoryService {
  constructor(
    private readonly movementRepo: InventoryMovementRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  receiveStock(ctx: TenantContext, actingRole: MerchantUserRole, input: ReceiveStockInput): string {
    assertCan({ role: actingRole }, "inventory:manage");
    assertValidReceipt(input.quantity, input.note);

    const movementId = this.movementRepo.record(ctx, {
      variantId: input.variantId,
      unitId: input.unitId,
      locationId: input.locationId,
      kind: "RECEIPT",
      quantity: input.quantity,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
      note: input.note,
    });

    this.auditLogRepo.append(ctx, {
      actorType: "USER",
      actorId: input.actorUserId,
      action: "inventory.receipt",
      entityType: "inventory_movements",
      entityId: movementId,
      afterJson: JSON.stringify({
        variantId: input.variantId,
        locationId: input.locationId,
        quantity: input.quantity,
        note: input.note,
      }),
      occurredAt: input.occurredAt,
    });

    return movementId;
  }

  getStock(ctx: TenantContext, variantId: string, locationId?: string): number {
    return this.movementRepo.sumStock(ctx, variantId, locationId);
  }
}
