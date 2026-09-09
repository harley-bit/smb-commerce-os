import type { FastifyInstance } from "fastify";
import { assertCan, ForbiddenActionError } from "@smb-os/domain";
import { ListingRepository, OrderRepository, OrderService, runSqliteMigrations, type Connection } from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * Lazily migrates `connection` on first use — same pattern as
 * `./calendar.ts`'s `createCalendarServiceFactory`.
 */
function createOrderServiceFactory(connection: Connection): () => Promise<OrderService> {
  let ready: Promise<OrderService> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(
      () => new OrderService(new OrderRepository(connection), new ListingRepository(connection)),
    );
    return ready;
  };
}

/**
 * `docs/cards/D115.md` — Order list and detail. Both routes are read-only,
 * gated by `orders:view` (granted to every merchant role, including
 * `READ_ONLY`) — no route in this file accepts anything but `GET`, so this
 * card's security check ("Role-gated: READ_ONLY cannot mutate") holds
 * structurally: there is no mutation surface to gate in the first place.
 */
export function registerOrderRoutes(app: FastifyInstance, connection: Connection): void {
  const getService = createOrderServiceFactory(connection);

  app.get("/orders", { preHandler: app.authenticate }, async (request, reply) => {
    try {
      assertCan({ role: request.auth!.role }, "orders:view", "order");
    } catch (error) {
      if (error instanceof ForbiddenActionError) {
        return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
      }
      throw error;
    }

    const orders = await getService();
    const summaries = orders.listOrders(request.auth!.tenant, request.auth!.role);
    return reply.code(200).send(summaries);
  });

  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        assertCan({ role: request.auth!.role }, "orders:view", "order");
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        throw error;
      }

      const orders = await getService();
      const detail = orders.getOrderDetail(request.auth!.tenant, request.auth!.role, request.params.orderId);
      if (!detail) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "Order not found.");
      }
      return reply.code(200).send(detail);
    },
  );
}
