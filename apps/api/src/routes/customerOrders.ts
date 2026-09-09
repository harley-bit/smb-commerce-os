import type { FastifyInstance } from "fastify";
import {
  createTenantContext,
  type AuthProvider,
  type CancellationPolicySet,
  type DepositHoldProvider,
  type RefundProvider,
} from "@smb-os/domain";
import {
  CustomerCancellationService,
  CustomerOrderHistoryService,
  DepositAuthorizationRepository,
  DepositAuthorizationService,
  ListingRepository,
  MerchantRepository,
  OrderAlreadyFinalizedError,
  OrderRepository,
  PaymentRepository,
  ReservationRepository,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

const SESSION_COOKIE = "session";

interface CustomerOrderServices {
  merchants: MerchantRepository;
  history: CustomerOrderHistoryService;
  cancellation: CustomerCancellationService;
}

/** Lazily migrates `connection` on first use — same pattern as `./orderConfirmation.ts`. */
function createServiceFactory(
  connection: Connection,
  refundProvider: RefundProvider,
  depositHoldProvider: DepositHoldProvider,
  cancellationPolicySet: CancellationPolicySet,
): () => Promise<CustomerOrderServices> {
  let ready: Promise<CustomerOrderServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const orderRepo = new OrderRepository(connection);
      const paymentRepo = new PaymentRepository(connection);
      const reservationRepo = new ReservationRepository(connection);
      const depositRepo = new DepositAuthorizationRepository(connection);
      const depositService = new DepositAuthorizationService(orderRepo, paymentRepo, depositRepo, depositHoldProvider);
      return {
        merchants: new MerchantRepository(connection),
        history: new CustomerOrderHistoryService(orderRepo, new ListingRepository(connection)),
        cancellation: new CustomerCancellationService(
          orderRepo,
          paymentRepo,
          reservationRepo,
          depositRepo,
          depositService,
          refundProvider,
          cancellationPolicySet,
        ),
      };
    });
    return ready;
  };
}

/**
 * `docs/cards/D132.md` — "Order history". The first customer-facing route
 * in this codebase to actually require a session: every Phase 7 checkout
 * route before it (`./checkoutPayment.ts`, `./orderConfirmation.ts`, ...)
 * has been unauthenticated, since a storefront customer had no session to
 * check yet. A customer looking up their own order history is exactly the
 * case a session buys real protection for, so this route verifies it via
 * the shared `AuthProvider` (D036/D101) the same way `GET /auth/me` does —
 * but *without* `app.authenticate`'s merchant-staff membership check,
 * since a customer is never a row in `merchant_users`. Only identity is
 * required; the merchant itself is resolved from the URL slug, the same
 * public-storefront posture as `./orderConfirmation.ts`.
 *
 * This card's acceptance criterion ("only the authenticated customer's
 * orders are returned"): both routes pass the session's own `userId` as
 * `customerUserId` into `CustomerOrderHistoryService`, never a
 * client-supplied value.
 *
 * This card's security check (IDOR: another customer's order id returns
 * 404): `getOrderDetail` returns `undefined` whenever the order belongs to
 * a different customer — indistinguishable from the order simply not
 * existing — so this route always answers `404`, never `403`, for both
 * cases.
 */
export function registerCustomerOrderRoutes(
  app: FastifyInstance,
  connection: Connection,
  authProvider: AuthProvider,
  refundProvider: RefundProvider,
  depositHoldProvider: DepositHoldProvider,
  cancellationPolicySet: CancellationPolicySet,
): void {
  const getServices = createServiceFactory(connection, refundProvider, depositHoldProvider, cancellationPolicySet);

  app.get<{ Params: { slug: string } }>("/v1/m/:slug/account/orders", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const identity = token ? await authProvider.verifySession(token) : null;
    if (!identity) {
      return sendProblem(
        request,
        reply,
        401,
        problemType("unauthorized"),
        "Unauthorized",
        "A valid session is required.",
      );
    }

    const { merchants, history } = await getServices();
    const merchant = merchants.findBySlug(request.params.slug);
    if (!merchant) {
      return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
    }

    const ctx = createTenantContext(merchant.id);
    const result = history.listOrderHistory(ctx, identity.userId, new Date().toISOString());
    return reply.code(200).send(result);
  });

  app.get<{ Params: { slug: string; orderId: string } }>(
    "/v1/m/:slug/account/orders/:orderId",
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      const identity = token ? await authProvider.verifySession(token) : null;
      if (!identity) {
        return sendProblem(
          request,
          reply,
          401,
          problemType("unauthorized"),
          "Unauthorized",
          "A valid session is required.",
        );
      }

      const { merchants, history } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      const detail = history.getOrderDetail(ctx, identity.userId, request.params.orderId);
      if (!detail) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order with that id.");
      }
      return reply.code(200).send(detail);
    },
  );

  /**
   * `docs/cards/D133.md` — "Cancellation flow". Same session-check shape as
   * the two routes above; the security check ("cancellation authority
   * verified against ownership") is enforced identically to D132's IDOR
   * defense: `CustomerCancellationService.cancelOrder` returns `undefined`
   * whenever the order belongs to a different customer, and this route maps
   * that to a flat 404 — the same response a nonexistent order id gets —
   * never a distinguishable 403.
   */
  app.post<{ Params: { slug: string; orderId: string } }>(
    "/v1/m/:slug/account/orders/:orderId/cancel",
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      const identity = token ? await authProvider.verifySession(token) : null;
      if (!identity) {
        return sendProblem(
          request,
          reply,
          401,
          problemType("unauthorized"),
          "Unauthorized",
          "A valid session is required.",
        );
      }

      const { merchants, cancellation } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
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

      const ctx = createTenantContext(merchant.id);
      try {
        const result = await cancellation.cancelOrder(ctx, identity.userId, request.params.orderId, {
          cancelledAt: new Date().toISOString(),
          idempotencyKey,
        });
        if (!result) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order with that id.");
        }
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof OrderAlreadyFinalizedError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );
}
