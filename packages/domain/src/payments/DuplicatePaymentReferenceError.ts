/**
 * `docs/design/03` "Payments and deposits" — `provider_ref` is unique per
 * `provider`, the idempotency anchor a webhook handler checks before
 * reprocessing an event. Thrown when a caller attempts to record a payment
 * against a `(provider, provider_ref)` pair that already exists, so a
 * duplicate webhook delivery never creates a second payment record.
 */
export class DuplicatePaymentReferenceError extends Error {
  constructor(
    public readonly provider: string,
    public readonly providerRef: string,
  ) {
    super(`A payment for provider "${provider}" with reference "${providerRef}" already exists.`);
    this.name = "DuplicatePaymentReferenceError";
  }
}
