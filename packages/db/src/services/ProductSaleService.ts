import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import type { InventoryMovementRepository } from "../repositories/InventoryMovementRepository.js";
import type { VariantRepository } from "../repositories/VariantRepository.js";
import type { InventoryUnitService } from "./InventoryUnitService.js";

export interface SellProductInput {
  variantId: string;
  unitId?: string;
  locationId: string;
  quantity: number;
  note: string;
  actorUserId: string;
  occurredAt: string;
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

    return { movementId, unitPriceMinor, lineTotalMinor, currency };
  }
}
