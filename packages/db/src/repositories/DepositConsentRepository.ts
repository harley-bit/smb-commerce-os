import { generateUuidV7 } from "@smb-os/domain";
import { and, desc, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { depositConsents } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface DepositConsent {
  id: string;
  merchantId: string;
  orderId: string;
  orderLineId: string;
  customerUserId: string;
  holdAmountMinor: number;
  currency: string;
  holdDurationDays: number;
  acknowledgedAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RecordDepositConsentInput {
  orderId: string;
  orderLineId: string;
  customerUserId: string;
  holdAmountMinor: number;
  currency: string;
  holdDurationDays: number;
  acknowledgedAt: string;
  ip?: string;
  userAgent?: string;
}

/**
 * `docs/cards/D129.md` — `deposit_consents.merchant_id` scopes every query,
 * per `docs/design/07` Control #1. Append-only, matching the schema: only
 * `record`/`findLatestForOrderLine` are exposed, no `update`/`delete` — same
 * convention as `CheckoutConsentRepository`.
 */
export class DepositConsentRepository extends TenantScopedRepository<typeof depositConsents.merchantId> {
  constructor(private readonly conn: Connection) {
    super(depositConsents.merchantId);
  }

  record: RepositoryMethod<[input: RecordDepositConsentInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(depositConsents)
      .values({
        id,
        merchantId: ctx.merchantId,
        orderId: input.orderId,
        orderLineId: input.orderLineId,
        customerUserId: input.customerUserId,
        holdAmountMinor: input.holdAmountMinor,
        currency: input.currency,
        holdDurationDays: input.holdDurationDays,
        acknowledgedAt: input.acknowledgedAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      .run();
    return id;
  };

  findLatestForOrderLine: RepositoryMethod<[orderLineId: string], DepositConsent | undefined> = (ctx, orderLineId) => {
    return this.conn.db
      .select()
      .from(depositConsents)
      .where(and(this.scope(ctx), eq(depositConsents.orderLineId, orderLineId)))
      .orderBy(desc(depositConsents.acknowledgedAt))
      .limit(1)
      .get() as DepositConsent | undefined;
  };
}
