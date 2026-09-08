import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { fulfillmentEvents } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type FulfillmentEventKind = "PICKED_UP" | "RETURNED" | "NO_SHOW" | "COMPLETED" | "CANCELLED";

export interface FulfillmentEvent {
  id: string;
  merchantId: string;
  orderLineId: string;
  kind: FulfillmentEventKind;
  occurredAt: string;
  actorUserId: string;
  note: string;
}

export interface RecordFulfillmentEventInput {
  orderLineId: string;
  kind: FulfillmentEventKind;
  occurredAt: string;
  actorUserId: string;
  note: string;
}

/**
 * `docs/design/03` "Rental lifecycle" / `docs/cards/D070.md` — `fulfillment_events`
 * is append-only: a rental order line's pickup/return history is a log, not
 * a mutable status field, so this repository exposes only `record` (insert)
 * and `listByOrderLine` (read) — no update/delete method exists, matching
 * `AuditLogRepository`'s and `InventoryMovementRepository`'s precedent.
 */
export class FulfillmentEventRepository extends TenantScopedRepository<
  typeof fulfillmentEvents.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(fulfillmentEvents.merchantId);
  }

  record: RepositoryMethod<[input: RecordFulfillmentEventInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(fulfillmentEvents)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  listByOrderLine: RepositoryMethod<[orderLineId: string], FulfillmentEvent[]> = (ctx, orderLineId) => {
    return this.conn.db
      .select()
      .from(fulfillmentEvents)
      .where(and(this.scope(ctx), eq(fulfillmentEvents.orderLineId, orderLineId)))
      .all() as FulfillmentEvent[];
  };
}
