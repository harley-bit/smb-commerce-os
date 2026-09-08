import { DuplicateWebhookEventError, generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { webhookEvents } from "../schema/sqlite.js";

export interface WebhookEvent {
  id: string;
  provider: string;
  eventId: string;
  payloadJson: string;
  receivedAt: string;
}

export interface RecordWebhookEventInput {
  provider: string;
  eventId: string;
  payloadJson: string;
  receivedAt: string;
}

/**
 * `docs/design/06` "Webhook handling" step 2 / `docs/cards/D092.md` —
 * persistence for `webhook_events`, the idempotency anchor for raw inbound
 * deliveries themselves (keyed on the provider's own event id, not the
 * `payments.provider_ref` anchor `PaymentRepository` owns). `record` relies
 * on the schema's own `(provider, event_id)` unique index rather than a
 * check-then-insert (which would race under concurrent webhook deliveries
 * — providers retry aggressively, `06`) and translates the resulting
 * constraint violation into `DuplicateWebhookEventError` rather than
 * leaking the raw driver error. Not a `TenantScopedRepository`: a raw
 * event hasn't been matched to a merchant yet at the point it's recorded
 * here, same reasoning as `UserRepository`.
 */
export class WebhookEventRepository {
  constructor(private readonly conn: Connection) {}

  record(input: RecordWebhookEventInput): string {
    const id = generateUuidV7();
    try {
      this.conn.db
        .insert(webhookEvents)
        .values({ id, ...input })
        .run();
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new DuplicateWebhookEventError(input.provider, input.eventId);
      }
      throw err;
    }
    return id;
  }

  findByProviderEventId(provider: string, eventId: string): WebhookEvent | undefined {
    return this.conn.db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)))
      .get() as WebhookEvent | undefined;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" &&
    err.message.includes("webhook_events.provider") &&
    err.message.includes("webhook_events.event_id")
  );
}
