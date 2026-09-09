import type { FastifyInstance } from "fastify";
import { createTenantContext } from "@smb-os/domain";
import {
  MerchantRepository,
  OrderConfirmationService,
  OrderConfirmationOrderNotFoundError as OrderNotFoundError,
  OrderRepository,
  runSqliteMigrations,
  type Connection,
  type ReceiptEmailNotifier,
} from "@smb-os/db";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem } from "../problemDetails.js";

export interface RegisterOrderConfirmationRoutesOptions {
  rateLimit?: { limit: number; windowMs: number };
}

interface OrderConfirmationServices {
  merchants: MerchantRepository;
  confirmation: OrderConfirmationService;
}

/** Lazily migrates `connection` on first use — same pattern as `./checkoutPayment.ts`. */
function createServiceFactory(
  connection: Connection,
  onReceiptEmail: ReceiptEmailNotifier,
): () => Promise<OrderConfirmationServices> {
  let ready: Promise<OrderConfirmationServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      confirmation: new OrderConfirmationService(new OrderRepository(connection), onReceiptEmail),
    }));
    return ready;
  };
}

/**
 * `docs/cards/D131.md` — "Order confirmation". Unauthenticated and
 * self-rate-limited, same posture as `./checkoutPayment.ts` — a storefront
 * customer has no staff session, and this route mirrors that one's current
 * lack of a `customerUserId` ownership check.
 *
 * This card's acceptance criterion ("receipt itemizes charges and any
 * deposit hold"): the response body is exactly `OrderConfirmationService`'s
 * `OrderReceipt` (`@smb-os/domain`'s `buildOrderReceipt`), built from the
 * order's own server-recomputed totals and each line's own server-recorded
 * fields, never from a request body — this route accepts no body at all.
 *
 * This card's security check ("no card details in the receipt"): see
 * `OrderConfirmationService`'s own doc comment — no field on `Order`/
 * `OrderLine` (or therefore `OrderReceipt`) can carry card data, so this
 * route cannot leak any either.
 */
export function registerOrderConfirmationRoutes(
  app: FastifyInstance,
  connection: Connection,
  onReceiptEmail: ReceiptEmailNotifier = () => undefined,
  options: RegisterOrderConfirmationRoutesOptions = {},
): void {
  const getServices = createServiceFactory(connection, onReceiptEmail);
  const limiter = new SlidingWindowRateLimiter(options.rateLimit?.limit ?? 10, options.rateLimit?.windowMs ?? 60_000);

  app.post<{ Params: { slug: string; orderId: string } }>(
    "/v1/m/:slug/checkout/:orderId/confirmation",
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

      const { merchants, confirmation } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      try {
        const receipt = confirmation.confirmOrder(ctx, {
          orderId: request.params.orderId,
          confirmedAt: new Date().toISOString(),
        });
        return reply.code(201).send(receipt);
      } catch (error) {
        if (error instanceof OrderNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order with that id.");
        }
        throw error;
      }
    },
  );
}
