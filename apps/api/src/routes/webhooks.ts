import type { FastifyInstance } from "fastify";
import { verifyStripeWebhookSignature } from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The exact bytes received on the wire, captured by `app.ts`'s
     * `application/json` content-type parser override. Signature
     * verification (`docs/cards/D091.md`) must run over these raw bytes,
     * never a re-serialized `request.body`, since JSON re-encoding is not
     * guaranteed byte-identical and would make a genuine signature fail.
     */
    rawBody?: string;
  }
}

const STRIPE_SIGNATURE_HEADER = "stripe-signature";

/**
 * `docs/cards/D091.md` — `docs/design/07`'s Spoofing table, "Forged Stripe
 * webhooks triggering deposit release" (**Critical**): "Signature
 * verification before parsing; unverified events discarded and logged as
 * security events." This route is deliberately unauthenticated (Stripe, not
 * a logged-in user, calls it) — the signature check is the only trust
 * boundary. An unsigned or wrongly-signed request is rejected with a
 * generic 400 and logged at `warn` as a security event; its body is never
 * read past the raw string already captured for verification, so a forged
 * event is never parsed, matched to an order, or acted on.
 *
 * No event-handling logic lives here yet (D092 idempotency, D093 ordering,
 * and the deposit-release wiring itself are later cards in this phase) —
 * this card's scope is the verification gate alone.
 */
export function registerWebhookRoutes(app: FastifyInstance, webhookSecret: string): void {
  app.post("/webhooks/stripe", async (request, reply) => {
    const signatureHeader = request.headers[STRIPE_SIGNATURE_HEADER];
    const rawBody = request.rawBody ?? "";
    const header = typeof signatureHeader === "string" ? signatureHeader : undefined;

    const result = verifyStripeWebhookSignature(rawBody, header, webhookSecret);
    if (!result.verified) {
      request.log.warn(
        { securityEvent: "webhook_signature_verification_failed", reason: result.reason },
        "rejected unverified Stripe webhook",
      );
      sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "Invalid webhook signature.");
      return;
    }

    return reply.code(200).send({ received: true });
  });
}
