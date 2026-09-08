import { generateUuidV7 } from "@smb-os/domain";
import { and, eq, sql } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { inventoryMovements } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type InventoryMovementKind =
  | "RECEIPT"
  | "SALE"
  | "RENTAL_OUT"
  | "RENTAL_IN"
  | "ADJUSTMENT"
  | "TRANSFER"
  | "WRITE_OFF";

export interface InventoryMovement {
  id: string;
  merchantId: string;
  variantId: string;
  unitId: string | null;
  locationId: string;
  kind: InventoryMovementKind;
  quantity: number;
  orderLineId: string | null;
  occurredAt: string;
  actorUserId: string;
  note: string;
}

export interface RecordMovementInput {
  variantId: string;
  unitId?: string;
  locationId: string;
  kind: InventoryMovementKind;
  quantity: number;
  orderLineId?: string;
  occurredAt: string;
  actorUserId: string;
  note: string;
}

/**
 * `docs/design/03` "Inventory — products and rentals": `inventory_movements`
 * is an append-only ledger — this repository exposes only `record` (insert)
 * and read methods, no update/delete, matching the schema's design. Current
 * stock is never stored; `sumStock` derives it by summing `quantity` for a
 * merchant-scoped variant (optionally narrowed to one location) on every
 * call, per `docs/design/03`'s "a counter that drifts cannot be
 * reconstructed" rationale.
 */
export class InventoryMovementRepository extends TenantScopedRepository<
  typeof inventoryMovements.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(inventoryMovements.merchantId);
  }

  record: RepositoryMethod<[input: RecordMovementInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(inventoryMovements)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  listByVariant: RepositoryMethod<[variantId: string], InventoryMovement[]> = (ctx, variantId) => {
    return this.conn.db
      .select()
      .from(inventoryMovements)
      .where(and(this.scope(ctx), eq(inventoryMovements.variantId, variantId)))
      .all() as InventoryMovement[];
  };

  sumStock: RepositoryMethod<[variantId: string, locationId?: string], number> = (
    ctx,
    variantId,
    locationId,
  ) => {
    const predicate = locationId
      ? and(
          this.scope(ctx),
          eq(inventoryMovements.variantId, variantId),
          eq(inventoryMovements.locationId, locationId),
        )
      : and(this.scope(ctx), eq(inventoryMovements.variantId, variantId));

    const row = this.conn.db
      .select({ total: sql<number>`COALESCE(SUM(${inventoryMovements.quantity}), 0)` })
      .from(inventoryMovements)
      .where(predicate)
      .get() as { total: number };

    return row.total;
  };
}
