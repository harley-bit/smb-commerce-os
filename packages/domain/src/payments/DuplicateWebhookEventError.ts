/**
 * `docs/design/06` "Webhook handling" step 2 / `docs/cards/D092.md` —
 * `(provider, event_id)` is the idempotency anchor for raw webhook
 * deliveries. Thrown when a caller attempts to record a webhook event that
 * has already been persisted, so a provider's retried/duplicate delivery
 * is recognized and discarded before any handler reprocesses it.
 */
export class DuplicateWebhookEventError extends Error {
  constructor(
    public readonly provider: string,
    public readonly eventId: string,
  ) {
    super(`A webhook event for provider "${provider}" with id "${eventId}" was already received.`);
    this.name = "DuplicateWebhookEventError";
  }
}
