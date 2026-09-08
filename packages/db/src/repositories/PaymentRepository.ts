import { DuplicatePaymentReferenceError, generateUuidV7 } from "@smb-os/domain";
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
