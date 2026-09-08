import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { conditionReports } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type ConditionReportPhase = "CHECKOUT" | "CHECKIN";

export interface ConditionReport {
  id: string;
  merchantId: string;
  orderLineId: string;
  inventoryUnitId: string;
  phase: ConditionReportPhase;
  conditionGrade: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateConditionReportInput {
  orderLineId: string;
  inventoryUnitId: string;
  phase: ConditionReportPhase;
  conditionGrade: string;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
}

/**
 * `docs/design/03` "Rental lifecycle" / `docs/cards/D072.md` — a rental's
 * condition report trail. `create` is the only write method — a report is a
 * point-in-time record, never edited after the fact. `hasCheckoutReport` is
 * the invariant I7 read path: `FulfillmentEventService` checks this before
 * letting a reservation reach `IN_USE`, since without a `CHECKOUT` baseline a
 * later damage claim has nothing to compare the returned item against.
 */
export class ConditionReportRepository extends TenantScopedRepository<
  typeof conditionReports.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(conditionReports.merchantId);
  }

  create: RepositoryMethod<[input: CreateConditionReportInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(conditionReports)
      .values({ id, merchantId: ctx.merchantId, notes: null, ...input })
      .run();
    return id;
  };

  listByOrderLine: RepositoryMethod<[orderLineId: string], ConditionReport[]> = (ctx, orderLineId) => {
    return this.conn.db
      .select()
      .from(conditionReports)
      .where(and(this.scope(ctx), eq(conditionReports.orderLineId, orderLineId)))
      .all() as ConditionReport[];
  };

  hasCheckoutReport: RepositoryMethod<[orderLineId: string], boolean> = (ctx, orderLineId) => {
    const row = this.conn.db
      .select({ id: conditionReports.id })
      .from(conditionReports)
      .where(
        and(
          this.scope(ctx),
          eq(conditionReports.orderLineId, orderLineId),
          eq(conditionReports.phase, "CHECKOUT"),
        ),
      )
      .get() as { id: string } | undefined;
    return row !== undefined;
  };
}
