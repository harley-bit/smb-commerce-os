import { generateUuidV7 } from "@smb-os/domain";
import { and, desc, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { checkoutConsents } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface CheckoutConsent {
  id: string;
  merchantId: string;
  orderId: string;
  customerUserId: string;
  termsVersion: string;
  consentedAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RecordConsentInput {
  orderId: string;
  customerUserId: string;
  termsVersion: string;
  consentedAt: string;
  ip?: string;
  userAgent?: string;
}

/**
 * `docs/cards/D128.md` — `checkout_consents.merchant_id` scopes every query,
 * per `docs/design/07` Control #1. Append-only, matching the schema: only
 * `record`/`findLatestForOrder` are exposed, no `update`/`delete`.
 */
export class CheckoutConsentRepository extends TenantScopedRepository<typeof checkoutConsents.merchantId> {
  constructor(private readonly conn: Connection) {
    super(checkoutConsents.merchantId);
  }

  record: RepositoryMethod<[input: RecordConsentInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(checkoutConsents)
      .values({
        id,
        merchantId: ctx.merchantId,
        orderId: input.orderId,
        customerUserId: input.customerUserId,
        termsVersion: input.termsVersion,
        consentedAt: input.consentedAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      .run();
    return id;
  };

  findLatestForOrder: RepositoryMethod<[orderId: string], CheckoutConsent | undefined> = (ctx, orderId) => {
    return this.conn.db
      .select()
      .from(checkoutConsents)
      .where(and(this.scope(ctx), eq(checkoutConsents.orderId, orderId)))
      .orderBy(desc(checkoutConsents.consentedAt))
      .limit(1)
      .get() as CheckoutConsent | undefined;
  };
}
