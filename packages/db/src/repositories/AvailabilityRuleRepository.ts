import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { availabilityRules } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface AvailabilityRule {
  id: string;
  merchantId: string;
  resourceId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface CreateAvailabilityRuleInput {
  resourceId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: string;
  validTo?: string;
}

export interface UpdateAvailabilityRuleInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * `availability_rules.merchant_id` scopes every query, same posture as
 * `ResourceRepository` — a rule row on its own doesn't carry personal data,
 * but it is only ever meaningful joined to a `resources` row that might, so
 * it gets the identical tenant-scoping treatment rather than being treated
 * as a lower-stakes table.
 */
export class AvailabilityRuleRepository extends TenantScopedRepository<
  typeof availabilityRules.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(availabilityRules.merchantId);
  }

  create: RepositoryMethod<[input: CreateAvailabilityRuleInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(availabilityRules)
      .values({
        id,
        merchantId: ctx.merchantId,
        validFrom: null,
        validTo: null,
        ...input,
      })
      .run();
    return id;
  };

  listByResource: RepositoryMethod<[resourceId: string], AvailabilityRule[]> = (
    ctx,
    resourceId,
  ) => {
    return this.conn.db
      .select()
      .from(availabilityRules)
      .where(and(this.scope(ctx), eq(availabilityRules.resourceId, resourceId)))
      .all() as AvailabilityRule[];
  };

  findById: RepositoryMethod<[id: string], AvailabilityRule | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(availabilityRules)
      .where(and(this.scope(ctx), eq(availabilityRules.id, id)))
      .get() as AvailabilityRule | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateAvailabilityRuleInput], void> = (
    ctx,
    id,
    patch,
  ) => {
    this.conn.db
      .update(availabilityRules)
      .set(patch)
      .where(and(this.scope(ctx), eq(availabilityRules.id, id)))
      .run();
  };

  remove: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.conn.db
      .delete(availabilityRules)
      .where(and(this.scope(ctx), eq(availabilityRules.id, id)))
      .run();
  };
}
