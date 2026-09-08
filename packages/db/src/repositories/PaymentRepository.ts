import { applyOrderedEvent, DuplicatePaymentReferenceError, generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { payments } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type PaymentKind = "CHARGE" | "REFUND" | "DEPOSIT_HOLD" | "DEPOSIT_CAPTURE";
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

export interface Payment {
  id: string;
  merchantId: string;
  orderId: string;
  provider: string;
  providerRef: string;
  kind: PaymentKind;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  rawEventJson: string | null;
  lastEventAt: string | null;
}

export interface ProviderStatusEvent {
  status: PaymentStatus;
  /** The provider's own event timestamp (Stripe's `created`), not receipt time. */
  occurredAt: string;
}

export interface CreatePaymentInput {
  orderId: string;
  provider: string;
  providerRef: string;
  kind: PaymentKind;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  rawEventJson?: string | null;
}

/**
 * `docs/design/03` "Payments and deposits" / `docs/cards/D088.md` —
 * persistence for `payments`. `provider_ref` is unique per `provider` — the
 * idempotency anchor a webhook handler checks before reprocessing an event
 * (`06`) — so `create` relies on the schema's own unique index rather than a
 * check-then-insert (which would race under concurrent webhook deliveries)
 * and translates the resulting constraint violation into
 * `DuplicatePaymentReferenceError` rather than leaking the raw driver error.
 */
export class PaymentRepository extends TenantScopedRepository<typeof payments.merchantId> {
  constructor(private readonly conn: Connection) {
    super(payments.merchantId);
  }

  create: RepositoryMethod<[input: CreatePaymentInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    try {
      this.conn.db
        .insert(payments)
        .values({
          id,
          merchantId: ctx.merchantId,
          rawEventJson: null,
          lastEventAt: null,
          ...input,
        })
        .run();
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new DuplicatePaymentReferenceError(input.provider, input.providerRef);
      }
      throw err;
    }
    return id;
  };

  findById: RepositoryMethod<[id: string], Payment | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(payments)
      .where(and(this.scope(ctx), eq(payments.id, id)))
      .get() as Payment | undefined;
  };

  findByProviderRef: RepositoryMethod<[provider: string, providerRef: string], Payment | undefined> = (
    ctx,
    provider,
    providerRef,
  ) => {
    return this.conn.db
      .select()
      .from(payments)
      .where(and(this.scope(ctx), eq(payments.provider, provider), eq(payments.providerRef, providerRef)))
      .get() as Payment | undefined;
  };

  /** `docs/cards/D096.md` — the refund service's lookup for an order's original charge (and any prior refunds). */
  listByOrderId: RepositoryMethod<[orderId: string], Payment[]> = (ctx, orderId) => {
    return this.conn.db
      .select()
      .from(payments)
      .where(and(this.scope(ctx), eq(payments.orderId, orderId)))
      .all() as Payment[];
  };

  /**
   * `docs/design/06` "Webhook handling" / `docs/cards/D093.md` — ordering
   * tolerance for a payment's status. Providers retry and deliver out of
   * order, so a webhook handler cannot trust arrival order to reflect
   * reality. Delegates the actual decision to `@smb-os/domain`'s
   * `applyOrderedEvent`: an incoming event no newer than `lastEventAt` is a
   * no-op, so applying a set of events in any arrival order converges to
   * the same final `status` — whichever event is chronologically last.
   */
  applyProviderEvent: RepositoryMethod<[id: string, event: ProviderStatusEvent], void> = (ctx, id, event) => {
    const row = this.findById(ctx, id);
    if (!row) {
      throw new Error(`Payment not found: ${id}`);
    }
    const resolved = applyOrderedEvent(
      { status: row.status, lastAppliedAt: row.lastEventAt },
      { status: event.status, occurredAt: event.occurredAt },
    );
    if (resolved.status === row.status && resolved.lastAppliedAt === row.lastEventAt) {
      return;
    }
    this.conn.db
      .update(payments)
      .set({ status: resolved.status, lastEventAt: resolved.lastAppliedAt })
      .where(and(this.scope(ctx), eq(payments.id, id)))
      .run();
  };
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" &&
    err.message.includes("payments.provider") &&
    err.message.includes("payments.provider_ref")
  );
}
