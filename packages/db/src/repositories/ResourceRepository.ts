import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { resources } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type ResourceKind = "STAFF" | "ROOM" | "EQUIPMENT";

export interface Resource {
  id: string;
  merchantId: string;
  locationId: string;
  kind: ResourceKind;
  name: string;
  capacity: number;
  archivedAt: string | null;
}

export interface CreateResourceInput {
  locationId: string;
  kind: ResourceKind;
  name: string;
  capacity: number;
}

export interface UpdateResourceInput {
  locationId?: string;
  name?: string;
  capacity?: number;
}

/**
 * `resources.merchant_id` scopes every query — a `STAFF`-kind row carries a
 * staff member's name, classified "Confidential" under `docs/design/08`'s
 * "Merchant staff" row, so cross-tenant leakage here is a real disclosure,
 * not just a catalog bug. `create` sets `merchantId` from `ctx.merchantId`
 * rather than trusting the input; every other method ANDs `this.scope(ctx)`
 * with the row's own id, same posture as `LocationRepository`.
 */
export class ResourceRepository extends TenantScopedRepository<typeof resources.merchantId> {
  constructor(private readonly conn: Connection) {
    super(resources.merchantId);
  }

  create: RepositoryMethod<[input: CreateResourceInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(resources)
      .values({ id, merchantId: ctx.merchantId, archivedAt: null, ...input })
      .run();
    return id;
  };

  list: RepositoryMethod<[], Resource[]> = (ctx) => {
    return this.conn.db.select().from(resources).where(this.scope(ctx)).all() as Resource[];
  };

  findById: RepositoryMethod<[id: string], Resource | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(resources)
      .where(and(this.scope(ctx), eq(resources.id, id)))
      .get() as Resource | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateResourceInput], void> = (ctx, id, patch) => {
    this.conn.db
      .update(resources)
      .set(patch)
      .where(and(this.scope(ctx), eq(resources.id, id)))
      .run();
  };

  archive: RepositoryMethod<[id: string, archivedAt: string], void> = (ctx, id, archivedAt) => {
    this.conn.db
      .update(resources)
      .set({ archivedAt })
      .where(and(this.scope(ctx), eq(resources.id, id)))
      .run();
  };
}
