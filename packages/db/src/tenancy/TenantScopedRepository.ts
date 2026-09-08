import type { TenantContext } from "@smb-os/domain";
import { eq, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * The shape every tenant-scoped repository method must have: `ctx` first,
 * then whatever else the method needs. `docs/design/07` Control #1 layer 2
 * requires this so a repository method missing a tenant scope fails to
 * type-check rather than shipping a cross-tenant read.
 */
export type RepositoryMethod<TArgs extends unknown[], TReturn> = (
  ctx: TenantContext,
  ...args: TArgs
) => TReturn;

/**
 * Base class every tenant-scoped repository extends. It holds only the
 * table's `merchant_id` column, not the table or the db handle — the only
 * predicate it can produce is `merchant_id = ctx.merchantId`, and the only
 * way to get one is to supply a real `TenantContext` (`scope()` has no
 * other overload and no default). Control #1 layer 3 (`docs/design/04`):
 * raw query construction stays banned outside this package, and this is
 * the one place the merchant_id predicate is built.
 */
export abstract class TenantScopedRepository<TMerchantIdColumn extends AnyColumn> {
  protected constructor(private readonly merchantIdColumn: TMerchantIdColumn) {}

  protected scope(ctx: TenantContext): SQL {
    return eq(this.merchantIdColumn, ctx.merchantId);
  }
}
