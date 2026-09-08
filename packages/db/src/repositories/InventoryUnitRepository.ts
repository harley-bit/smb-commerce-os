import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { inventoryUnits } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type InventoryUnitTrackingMode = "SERIALIZED" | "FUNGIBLE";
export type InventoryUnitStatus = "AVAILABLE" | "SOLD" | "MAINTENANCE" | "RETIRED" | "LOST";

export interface InventoryUnit {
  id: string;
  merchantId: string;
  variantId: string;
  locationId: string;
  unitCode: string;
  trackingMode: InventoryUnitTrackingMode;
  status: InventoryUnitStatus;
  acquisitionCostMinor: number | null;
  acquiredAt: string | null;
  expectedLifeMonths: number | null;
  conditionGrade: string | null;
  retiredAt: string | null;
}

export interface CreateInventoryUnitInput {
  variantId: string;
  locationId: string;
  unitCode: string;
  trackingMode: InventoryUnitTrackingMode;
  acquisitionCostMinor?: number;
  acquiredAt?: string;
  expectedLifeMonths?: number;
  conditionGrade?: string;
}

/**
 * `inventory_units.merchant_id` scopes every query, per `docs/design/07`
 * Control #1. `create` always starts a unit in `AVAILABLE` — every other
 * status is reached only through `updateStatus`, which is the enforcement
 * point for `InventoryUnitService`'s status-transition state machine, not
 * this repository (this class performs whatever transition it's told to,
 * the same split as `ListingRepository`/`ListingService`).
 */
export class InventoryUnitRepository extends TenantScopedRepository<typeof inventoryUnits.merchantId> {
  constructor(private readonly conn: Connection) {
    super(inventoryUnits.merchantId);
  }

  create: RepositoryMethod<[input: CreateInventoryUnitInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(inventoryUnits)
      .values({
        id,
        merchantId: ctx.merchantId,
        status: "AVAILABLE",
        ...input,
      })
      .run();
    return id;
  };

  findById: RepositoryMethod<[id: string], InventoryUnit | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(inventoryUnits)
      .where(and(this.scope(ctx), eq(inventoryUnits.id, id)))
      .get() as InventoryUnit | undefined;
  };

  listByVariant: RepositoryMethod<[variantId: string], InventoryUnit[]> = (ctx, variantId) => {
    return this.conn.db
      .select()
      .from(inventoryUnits)
      .where(and(this.scope(ctx), eq(inventoryUnits.variantId, variantId)))
      .all() as InventoryUnit[];
  };

  updateStatus: RepositoryMethod<[id: string, status: InventoryUnitStatus, occurredAt: string], void> = (
    ctx,
    id,
    status,
    occurredAt,
  ) => {
    this.conn.db
      .update(inventoryUnits)
      .set({ status, retiredAt: status === "RETIRED" ? occurredAt : null })
      .where(and(this.scope(ctx), eq(inventoryUnits.id, id)))
      .run();
  };
}
