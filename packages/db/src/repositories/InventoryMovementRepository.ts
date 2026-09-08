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

/** Thrown by `guardedDecrement` when a decrement would take stock negative — invariant I5. */
export class InsufficientStockError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(`Insufficient stock: requested ${requested}, only ${available} available`);
    this.name = "InsufficientStockError";
  }
}

const DECREMENT_KINDS: readonly InventoryMovementKind[] = [
  "SALE",
  "RENTAL_OUT",
  "ADJUSTMENT",
  "TRANSFER",
  "WRITE_OFF",
];

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

  /**
   * Invariant I5 (`docs/design/03`): stock must never go negative, enforced
   * by a check "within the write transaction" — not a check-then-write
   * across two statements, which two concurrent callers could both pass
   * before either commits. `sqlite.transaction(...).immediate()` opens with
   * `BEGIN IMMEDIATE` rather than the default deferred transaction, so the
   * write lock is acquired *before* the SELECT runs: a second concurrent
   * caller blocks at BEGIN IMMEDIATE until the first transaction commits,
   * and therefore always reads the post-commit stock, not a stale value.
   * `quantity` here is the positive amount to remove; it's stored signed
   * negative in the ledger, matching every other decrement kind's rows.
   */
  guardedDecrement: RepositoryMethod<[input: RecordMovementInput], string> = (ctx, input) => {
    if (!DECREMENT_KINDS.includes(input.kind)) {
      throw new Error(`guardedDecrement does not accept movement kind "${input.kind}"`);
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error(`guardedDecrement quantity must be a positive integer, got: ${input.quantity}`);
    }

    const attempt = this.conn.sqlite.transaction((): string => {
      const available = this.sumStock(ctx, input.variantId, input.locationId);
      if (available - input.quantity < 0) {
        throw new InsufficientStockError(available, input.quantity);
      }

      const id = generateUuidV7();
      this.conn.db
        .insert(inventoryMovements)
        .values({ id, merchantId: ctx.merchantId, ...input, quantity: -input.quantity })
        .run();
      return id;
    });

    return attempt.immediate();
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
