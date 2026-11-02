import type { FastifyInstance } from "fastify";
import { assertCan, ForbiddenActionError } from "@smb-os/domain";
import {
  CalendarService,
  InventoryUnitRepository,
  ReservationRepository,
  ResourceRepository,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * Lazily migrates `connection` on first use — same pattern as
 * `./bookings.ts`'s `createBookingServiceFactory`.
 */
function createCalendarServiceFactory(connection: Connection): () => Promise<CalendarService> {
  let ready: Promise<CalendarService> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(
      () =>
        new CalendarService(
          new ReservationRepository(connection),
          new ResourceRepository(connection),
          new InventoryUnitRepository(connection),
        ),
    );
    return ready;
  };
}

/**
 * `docs/cards/D114.md` — Unified calendar: `RESOURCE` service bookings and
 * `INVENTORY_UNIT` rental reservations, in one merchant-scoped, filterable
 * view. Read-only, so it's gated by `bookings:view` (granted to every
 * merchant role, including `READ_ONLY`) rather than `bookings:manage` —
 * this route never writes anything.
 *
 * This card's security check ("no customer data beyond what staff need"):
 * `CalendarService.getCalendar` never returns `createdByIp`/
 * `createdByAccountId` on any entry — see that class's own doc comment.
 */
export function registerCalendarRoutes(app: FastifyInstance, connection: Connection): void {
  const getService = createCalendarServiceFactory(connection);

  app.get<{ Querystring: { rangeStart?: string; rangeEnd?: string } }>(
    "/calendar",
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        assertCan({ role: request.auth!.role }, "bookings:view", "calendar");
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        throw error;
      }

      const { rangeStart, rangeEnd } = request.query;
      if (!rangeStart || !rangeEnd) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "rangeStart and rangeEnd are required query parameters.",
        );
      }

      const calendar = await getService();
      const entries = calendar.getCalendar(request.auth!.tenant, request.auth!.role, rangeStart, rangeEnd);
      return reply.code(200).send(entries);
    },
  );
}
