import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { availabilityExceptions } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type AvailabilityExceptionKind = "BLACKOUT" | "EXTRA";

export interface AvailabilityException {
  id: string;
  merchantId: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  kind: AvailabilityExceptionKind;
  note: string | null;
}

export interface CreateAvailabilityExceptionInput {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  kind: AvailabilityExceptionKind;
  note?: string;
}

export interface UpdateAvailabilityExceptionInput {
  startsAt?: string;
  endsAt?: string;
  kind?: AvailabilityExceptionKind;
  note?: string | null;
}

/**
 * `availability_exceptions.merchant_id` scopes every query — same posture
 * as `AvailabilityRuleRepository`.
 */
export class AvailabilityExceptionRepository extends TenantScopedRepository<
  typeof availabilityExceptions.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(availabilityExceptions.merchantId);
  }

  create: RepositoryMethod<[input: CreateAvailabilityExceptionInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(availabilityExceptions)
      .values({ id, merchantId: ctx.merchantId, note: null, ...input })
      .run();
    return id;
  };

  listByResource: RepositoryMethod<[resourceId: string], AvailabilityException[]> = (
    ctx,
    resourceId,
  ) => {
    return this.conn.db
      .select()
      .from(availabilityExceptions)
      .where(and(this.scope(ctx), eq(availabilityExceptions.resourceId, resourceId)))
      .all() as AvailabilityException[];
  };

  findById: RepositoryMethod<[id: string], AvailabilityException | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(availabilityExceptions)
      .where(and(this.scope(ctx), eq(availabilityExceptions.id, id)))
      .get() as AvailabilityException | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateAvailabilityExceptionInput], void> = (
    ctx,
    id,
    patch,
  ) => {
    this.conn.db
      .update(availabilityExceptions)
      .set(patch)
      .where(and(this.scope(ctx), eq(availabilityExceptions.id, id)))
      .run();
  };

  remove: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.conn.db
      .delete(availabilityExceptions)
      .where(and(this.scope(ctx), eq(availabilityExceptions.id, id)))
      .run();
  };
}
