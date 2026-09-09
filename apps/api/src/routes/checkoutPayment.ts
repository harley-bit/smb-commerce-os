import type { FastifyInstance } from "fastify";
import { createTenantContext } from "@smb-os/domain";
import type { PaymentIntentProvider } from "@smb-os/domain";
import {
  CheckoutPaymentService,
  MerchantRepository,
  OrderRepository,
  PaymentDeclinedError,
  CheckoutMissingIdempotencyKeyError as MissingIdempotencyKeyError,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem, toProblemDetails } from "../problemDetails.js";

export interface RegisterCheckoutPaymentRoutesOptions {
  rateLimit?: { limit: number; windowMs: number };
  /** `docs/design/15`'s platform take rate — a basis-point figure, not hardcoded in domain math (`computeApplicationFeeSplit`, D089). */
  takeRateBasisPoints?: number;
}

/** No commission rate has been finalized by `docs/design/15` yet — a placeholder pending that decision, not a silent invented default. */
const DEFAULT_TAKE_RATE_BASIS_POINTS = 250;

interface CheckoutPaymentServices {
  merchants: MerchantRepository;
  checkout: CheckoutPaymentService;
}

/** Lazily migrates `connection` on first use — same pattern as `./publicStorefront.ts`'s `createServiceFactory`. */
function createServiceFactory(
  connection: Connection,
  provider: PaymentIntentProvider,
): () => Promise<CheckoutPaymentServices> {
  let ready: Promise<CheckoutPaymentServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      checkout: new CheckoutPaymentService(new OrderRepository(connection), provider),
    }));
    return ready;
  };
}

/**
 * `docs/cards/D130.md` — Payment UI's server side: the first HTTP route
 * ever wired to D089's `CheckoutPaymentService`, closing the gap D126–D129's
 * logs each called out ("no storefront checkout endpoint exists at all
 * yet") for the payment step specifically. Unauthenticated and
 * self-rate-limited, same posture as `./publicStorefront.ts` — a storefront
 * customer has no staff session.
 *
 * This card's acceptance criterion ("no card data in our DOM/server"): this
 * route never accepts a card number, CVC, or expiry in its request body at
 * all — the only output is a Stripe-hosted-fields `clientSecret`, which the
 * browser uses to confirm the card directly against Stripe (or, in this
 * codebase's still-simulated posture, `SimulatedPaymentIntentProvider`)
 * without ever routing raw card data through this server, per
 * `docs/design/07`'s "card data never touches our servers".
 */
export function registerCheckoutPaymentRoutes(
  app: FastifyInstance,
  connection: Connection,
  provider: PaymentIntentProvider,
  options: RegisterCheckoutPaymentRoutesOptions = {},
): void {
  const getServices = createServiceFactory(connection, provider);
  const limiter = new SlidingWindowRateLimiter(options.rateLimit?.limit ?? 10, options.rateLimit?.windowMs ?? 60_000);
  const takeRateBasisPoints = options.takeRateBasisPoints ?? DEFAULT_TAKE_RATE_BASIS_POINTS;

  app.post<{ Params: { slug: string; orderId: string } }>(
    "/v1/m/:slug/checkout/:orderId/payment-intent",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(
          request,
          reply,
          429,
          problemType("rate-limited"),
          "Too Many Requests",
          "Too many requests. Try again later.",
        );
      }

      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "Idempotency-Key header is required.",
        );
      }

      const { merchants, checkout } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }
      if (!merchant.connectAccountId) {
        return sendProblem(
          request,
          reply,
          409,
          problemType("conflict"),
          "Conflict",
          "This merchant has not completed payments setup.",
        );
      }

      const ctx = createTenantContext(merchant.id);
      try {
        const result = await checkout.createCheckoutIntent(ctx, {
          orderId: request.params.orderId,
          connectedAccountId: merchant.connectAccountId,
          takeRateBasisPoints,
          idempotencyKey,
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof PaymentDeclinedError) {
          // `docs/cards/D098.md` — `error.message` is always the mapped,
          // generic customer message; the provider's raw decline code never
          // reaches this response.
          return reply
            .code(402)
            .type("application/problem+json")
            .send({
              ...toProblemDetails(request, 402, problemType("payment-declined"), "Payment Declined", error.message),
              retryableWithSameMethod: error.retryableWithSameMethod,
            });
        }
        if (error instanceof MissingIdempotencyKeyError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        if (error instanceof Error && error.message.startsWith("Order not found")) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order with that id.");
        }
        if (error instanceof Error && error.message.startsWith("Cannot check out order")) {
          return sendProblem(
            request,
            reply,
            409,
            problemType("conflict"),
            "Conflict",
            "This order cannot be checked out.",
          );
        }
        throw error;
      }
    },
  );
}
