import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { merchantUsers } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type MerchantUserRole = "OWNER" | "ADMIN" | "STAFF" | "READ_ONLY";

export interface MerchantUser {
  merchantId: string;
  userId: string;
  role: MerchantUserRole;
  createdAt: string;
}

/**
 * `merchant_users` scopes every query on `merchant_id`, per
 * `docs/design/07` Control #1. `docs/design/07`'s role table restricts
 * role assignment to `OWNER` ("Full merchant control including... role
 * assignment"; `ADMIN` gets "no... role changes") — enforced here as a
 * runtime check on the caller-supplied acting role, since the repository
 * layer has no independent way to know who is calling beyond what its
 * caller asserts. **Audit logging and owner notification for role
 * changes (this card's security check) are not yet implemented** — the
 * hash-chained `audit_log` table is D030's job; see this card's log for
 * the tracked gap.
 */
export class MerchantUserRepository extends TenantScopedRepository<typeof merchantUsers.merchantId> {
  constructor(private readonly conn: Connection) {
    super(merchantUsers.merchantId);
  }

  assignRole: RepositoryMethod<
    [actingRole: MerchantUserRole, targetUserId: string, role: MerchantUserRole, createdAt: string],
    void
  > = (ctx, actingRole, targetUserId, role, createdAt) => {
    if (actingRole !== "OWNER") {
      throw new Error(`Role assignment is restricted to OWNER, got acting role: ${actingRole}`);
    }
    this.conn.db
      .insert(merchantUsers)
      .values({ merchantId: ctx.merchantId, userId: targetUserId, role, createdAt })
      .onConflictDoUpdate({
        target: [merchantUsers.merchantId, merchantUsers.userId],
        set: { role },
      })
      .run();
  };

  findRole: RepositoryMethod<[userId: string], MerchantUserRole | undefined> = (ctx, userId) => {
    const row = this.conn.db
      .select()
      .from(merchantUsers)
      .where(and(this.scope(ctx), eq(merchantUsers.userId, userId)))
      .get() as MerchantUser | undefined;
    return row?.role;
  };

  list: RepositoryMethod<[], MerchantUser[]> = (ctx) => {
    return this.conn.db
      .select()
      .from(merchantUsers)
      .where(this.scope(ctx))
      .all() as MerchantUser[];
  };
}
