import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { pushDeviceTokens } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type PushPlatform = "ios" | "android";

export interface PushDeviceToken {
  id: string;
  merchantId: string;
  customerUserId: string;
  platform: string;
  token: string;
  createdAt: string;
}

export interface RegisterPushDeviceTokenInput {
  customerUserId: string;
  platform: PushPlatform;
  token: string;
  createdAt: string;
}

/**
 * `docs/cards/D148.md` — `push_device_tokens.merchant_id` scopes every
 * query, per `docs/design/07` Control #1. `register` upserts on the table's
 * `(merchant_id, token)` unique index — a device re-registering (reinstall,
 * token rotation) replaces its own prior row rather than accumulating stale
 * ones.
 */
export class PushDeviceTokenRepository extends TenantScopedRepository<typeof pushDeviceTokens.merchantId> {
  constructor(private readonly conn: Connection) {
    super(pushDeviceTokens.merchantId);
  }

  register: RepositoryMethod<[input: RegisterPushDeviceTokenInput], string> = (ctx, input) => {
    const existing = this.conn.db
      .select()
      .from(pushDeviceTokens)
      .where(and(this.scope(ctx), eq(pushDeviceTokens.token, input.token)))
      .get() as PushDeviceToken | undefined;

    if (existing) {
      this.conn.db
        .update(pushDeviceTokens)
        .set({ customerUserId: input.customerUserId, platform: input.platform, createdAt: input.createdAt })
        .where(and(this.scope(ctx), eq(pushDeviceTokens.id, existing.id)))
        .run();
      return existing.id;
    }

    const id = generateUuidV7();
    this.conn.db
      .insert(pushDeviceTokens)
      .values({
        id,
        merchantId: ctx.merchantId,
        customerUserId: input.customerUserId,
        platform: input.platform,
        token: input.token,
        createdAt: input.createdAt,
      })
      .run();
    return id;
  };

  listForCustomer: RepositoryMethod<[customerUserId: string], PushDeviceToken[]> = (ctx, customerUserId) => {
    return this.conn.db
      .select()
      .from(pushDeviceTokens)
      .where(and(this.scope(ctx), eq(pushDeviceTokens.customerUserId, customerUserId)))
      .all() as PushDeviceToken[];
  };
}
