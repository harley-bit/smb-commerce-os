import type { Connection } from "../connection.js";
import { merchants } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "OFFBOARDED";
  defaultCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface CreateMerchantInput {
  name: string;
  slug: string;
  status: Merchant["status"];
  defaultCurrency: string;
  createdAt: string;
}

export interface UpdateMerchantInput {
  name?: string;
  slug?: string;
  status?: Merchant["status"];
  defaultCurrency?: string;
}

/**
 * `merchants` has no `merchant_id` column of its own — the row's own `id`
 * *is* the tenant boundary. Scoping on `merchants.id` means every method
 * here can only ever touch the caller's own merchant row: `create` sets
 * `id` from `ctx.merchantId` rather than trusting the input, and
 * `findOwn`/`update`/`archive` filter on `this.scope(ctx)` like any other
 * tenant-scoped repository (`docs/design/07` Control #1, runtime layer).
 */
export class MerchantRepository extends TenantScopedRepository<typeof merchants.id> {
  constructor(private readonly conn: Connection) {
    super(merchants.id);
  }

  create: RepositoryMethod<[input: CreateMerchantInput], void> = (ctx, input) => {
    this.conn.db
      .insert(merchants)
      .values({ id: ctx.merchantId, ...input })
      .run();
  };

  findOwn: RepositoryMethod<[], Merchant | undefined> = (ctx) => {
    return this.conn.db
      .select()
      .from(merchants)
      .where(this.scope(ctx))
      .get() as Merchant | undefined;
  };

  update: RepositoryMethod<[patch: UpdateMerchantInput], void> = (ctx, patch) => {
    this.conn.db.update(merchants).set(patch).where(this.scope(ctx)).run();
  };

  archive: RepositoryMethod<[archivedAt: string], void> = (ctx, archivedAt) => {
    this.conn.db
      .update(merchants)
      .set({ archivedAt })
      .where(this.scope(ctx))
      .run();
  };
}
