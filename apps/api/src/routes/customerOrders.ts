import type { FastifyInstance } from "fastify";
import { createTenantContext, type AuthProvider } from "@smb-os/domain";
import {
  CustomerOrderHistoryService,
  ListingRepository,
  MerchantRepository,
  OrderRepository,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

const SESSION_COOKIE = "session";

interface CustomerOrderServices {
  merchants: MerchantRepository;
  history: CustomerOrderHistoryService;
}

/** Lazily migrates `connection` on first use — same pattern as `./orderConfirmation.ts`. */
function createServiceFactory(connection: Connection): () => Promise<CustomerOrderServices> {
  let ready: Promise<CustomerOrderServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      history: new CustomerOrderHistoryService(new OrderRepository(connection), new ListingRepository(connection)),
    }));
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
export function registerCustomerOrderRoutes(app: FastifyInstance, connection: Connection, authProvider: AuthProvider): void {
  const getServices = createServiceFactory(connection);

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
}
