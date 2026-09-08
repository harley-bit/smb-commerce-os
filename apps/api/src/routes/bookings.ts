import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, IllegalReservationTransitionError } from "@smb-os/domain";
import {
  BookingService,
  HoldLimitExceededError,
  MissingIdempotencyKeyError,
  ReservationConflictError,
  ReservationRepository,
  ResourceRepository,
  runSqliteMigrations,
  type AvailabilityCache,
  type Connection,
} from "@smb-os/db";
import { createServiceBookingInputSchema } from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * The HTTP contract carries `Idempotency-Key` as its own header (per
 * `docs/design/06`'s conventions table), not a body field — this route is
 * the schema's first HTTP caller (D059's schema was written for
 * `BookingService`'s in-process input, where it doubles as the body key).
 */
const createBookingBodySchema = createServiceBookingInputSchema.omit({ idempotencyKey: true });

/**
 * Same defense-in-depth pattern as `./listings.ts`'s `requireAction` —
 * `BookingService` already re-asserts `bookings:manage` internally
 * (D059), this is a second, route-level check per this card's acceptance
 * criterion.
 */
function requireBookingsManage(request: FastifyRequest, reply: FastifyReply): boolean {
  try {
    assertCan({ role: request.auth!.role }, "bookings:manage", "booking");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenActionError) {
      sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
      return false;
    }
    throw error;
  }
}

interface BookingRouteServices {
  bookings: BookingService;
  reservations: ReservationRepository;
}

/**
 * Lazily migrates `connection` on first use — same pattern as
 * `./listings.ts`'s `createListingServiceFactory`.
 */
function createBookingServiceFactory(
  connection: Connection,
  cache?: AvailabilityCache,
): () => Promise<BookingRouteServices> {
  let ready: Promise<BookingRouteServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const reservations = new ReservationRepository(connection, cache);
      return {
        bookings: new BookingService(new ResourceRepository(connection), reservations),
        reservations,
      };
    });
    return ready;
  };
}

/**
 * `docs/cards/D061.md` — HTTP surface over D059's `BookingService`
 * (HELD → CONFIRMED). Staff-authenticated, same session/tenant model as
 * `./listings.ts` — booking a resource on a customer's behalf is a
 * routine operational action (`bookings:manage`, OWNER/ADMIN/STAFF), not
 * a public storefront checkout.
 *
 * This card's security check (information disclosure via a booking
 * response): a booking response — including a 409 conflict — must never
 * reveal another reservation's id, `orderLineId`, or any other field
 * that would identify who holds a conflicting slot. `ReservationConflictError`
 * carries only `subjectType`/`subjectId` (the *resource*, not a person),
 * so the 409 handler below intentionally does not forward `error.message`
 * or otherwise inspect/expose the conflicting row.
 */
export function registerBookingRoutes(app: FastifyInstance, connection: Connection, cache?: AvailabilityCache): void {
  const getServices = createBookingServiceFactory(connection, cache);

  app.post<{ Body: unknown }>("/bookings", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireBookingsManage(request, reply)) {
      return reply;
    }
    const parsed = createBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
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

    const { bookings } = await getServices();
    try {
      const id = bookings.createServiceBooking(request.auth!.tenant, request.auth!.role, {
        ...parsed.data,
        idempotencyKey,
        createdAt: new Date().toISOString(),
        // `docs/cards/D062.md` — the concurrent-hold cap's two dimensions.
        // This route is always staff-authenticated (never anonymous, see
        // `requireBookingsManage` above), so `createdByAccountId` is always
        // set here; `BookingService`'s `anonymousLimit` branch is exercised
        // by a future public/anonymous checkout endpoint, not this one.
        createdByAccountId: request.auth!.identity.userId,
        createdByIp: request.ip,
      });
      return reply.code(201).send({ id, state: "HELD" });
    } catch (error) {
      if (error instanceof ReservationConflictError) {
        // Deliberately generic — no conflicting reservation id, orderLineId,
        // or timing beyond what the caller already sent (this card's
        // security check).
        return sendProblem(
          request,
          reply,
          409,
          problemType("conflict"),
          "Conflict",
          "This resource is not available for the requested time.",
        );
      }
      if (error instanceof HoldLimitExceededError) {
        return sendProblem(request, reply, 429, problemType("too-many-requests"), "Too Many Requests", error.message);
      }
      if (error instanceof MissingIdempotencyKeyError) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
      }
      if (error instanceof Error && error.message.startsWith("Resource not found")) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/bookings/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireBookingsManage(request, reply)) {
      return reply;
    }
    const { reservations } = await getServices();
    const booking = reservations.findById(request.auth!.tenant, request.params.id);
    if (!booking) {
      return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No booking with that id.");
    }
    return reply.code(200).send(booking);
  });

  app.post<{ Params: { id: string } }>(
    "/bookings/:id/confirm",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireBookingsManage(request, reply)) {
        return reply;
      }
      const { bookings, reservations } = await getServices();
      const existing = reservations.findById(request.auth!.tenant, request.params.id);
      if (!existing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No booking with that id.");
      }
      try {
        bookings.confirmServiceBooking(request.auth!.tenant, request.auth!.role, request.params.id);
      } catch (error) {
        if (error instanceof IllegalReservationTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
      return reply.code(200).send(reservations.findById(request.auth!.tenant, request.params.id));
    },
  );
}
