import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `docs/cards/D091.md` — `docs/design/07`'s Spoofing table, "Forged Stripe
 * webhooks triggering deposit release" (**Critical**): "Signature
 * verification before parsing; unverified events discarded and logged as
 * security events." This is that verification, in the same "native now,
 * real provider later" style as `HmacMediaUploadProvider` (D073) — Stripe's
 * own signature scheme (`Stripe-Signature: t=<timestamp>,v1=<hex hmac>`,
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with the webhook signing
 * secret) reimplemented with Node's built-in `crypto` rather than the
 * `stripe` SDK, since no Stripe account is wired up yet.
 *
 * "Verify before parse": this function never calls `JSON.parse` on the raw
 * body until the signature has already been checked, so a forged or
 * tampered payload is never even deserialized, let alone acted on. Callers
 * are expected to discard the raw body and log a security event on any
 * `verified: false` result rather than falling back to trusting it.
 */
export interface WebhookVerificationOptions {
  /** Replay-protection window; Stripe's own default is 300s. */
  readonly toleranceSeconds?: number;
  /** Injectable clock for tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

export type WebhookVerificationResult =
  | { readonly verified: true; readonly event: unknown }
  | { readonly verified: false; readonly reason: string };

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(",").map((part) => part.trim());
  let timestamp: string | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) {
      timestamp = value;
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return null;
  }
  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * `rawBody` must be the exact bytes received on the wire (as a string) —
 * never a re-serialized/re-parsed version, since JSON re-encoding is not
 * guaranteed byte-identical and would make a genuine signature fail.
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  options: WebhookVerificationOptions = {},
): WebhookVerificationResult {
  if (!signatureHeader) {
    return { verified: false, reason: "missing Stripe-Signature header" };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { verified: false, reason: "malformed Stripe-Signature header" };
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = (options.now ?? Date.now)();
  const nowSeconds = Math.floor(now / 1000);
  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { verified: false, reason: "malformed Stripe-Signature timestamp" };
  }
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { verified: false, reason: "timestamp outside replay tolerance window" };
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");

  const matched = parsed.signatures.some((candidate) => safeEqualHex(candidate, expectedSignature));
  if (!matched) {
    return { verified: false, reason: "signature mismatch" };
  }

  return { verified: true, event: JSON.parse(rawBody) };
}
