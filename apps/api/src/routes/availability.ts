import type { FastifyInstance } from "fastify";
import {
  AvailabilityExceptionRepository,
  AvailabilityRangeTooLargeError,
  AvailabilityRuleRepository,
  AvailabilityService,
  LocationRepository,
  MerchantRepository,
  ReservationRepository,
  ResourceNotFoundError,
  ResourceRepository,
  runSqliteMigrations,
  type AvailabilityCache,
  type Connection,
} from "@smb-os/db";
import { createTenantContext } from "@smb-os/domain";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem } from "../problemDetails.js";

interface AvailabilityRouteServices {
  merchants: MerchantRepository;
  availability: AvailabilityService;
}

/**
 * Lazily migrates `connection` on first use, same pattern as
 * `./listings.ts`'s `createListingServiceFactory` — `buildApp()` is
 * synchronous, migrations are not.
 */
function createAvailabilityServiceFactory(
  connection: Connection,
  cache: AvailabilityCache,
): () => Promise<AvailabilityRouteServices> {
  let ready: Promise<AvailabilityRouteServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      availability: new AvailabilityService(
        new ResourceRepository(connection),
        new LocationRepository(connection),
        new AvailabilityRuleRepository(connection),
        new AvailabilityExceptionRepository(connection),
        // Same cache the route reads from — a booking write through this
        // repository instance invalidates the exact entries this route
        // would otherwise keep serving stale (this card's acceptance
        // criterion).
        new ReservationRepository(connection, cache),
        cache,
      ),
    }));
    return ready;
  };
}

export interface RegisterAvailabilityRoutesOptions {
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * `docs/design/06` "The availability endpoint" — `GET
 * /v1/m/{slug}/availability`. Unauthenticated by design (a storefront
 * visitor has no session yet), so this is the one route in `apps/api` that
 * resolves its own `TenantContext` from a public `{slug}` rather than from
 * `request.auth`, and the one route that needs its own rate limiter rather
 * than relying on `assertCan`/`app.authenticate` for protection — per this
 * card's security check, it gets the tightest budget in the system: it's
 * the cheapest endpoint to scrape and the most expensive to compute
 * (`docs/design/07`, `docs/design/14` risk T13).
 *
 * The query takes `resourceId`, not doc 06's literal `variantId` — no
 * `listing_resources` join maps a listing/variant to the resource(s) that
 * fulfil it yet (flagged as a carryover gap in `docs/logs/D058.md` and
 * `docs/logs/D059.md`); `BookingService` (D059) already made the same
 * documented deviation for its create-booking input. Resolving that join is
 * out of scope for this card.
 */
export function registerAvailabilityRoutes(
  app: FastifyInstance,
  connection: Connection,
  cache: AvailabilityCache,
  options: RegisterAvailabilityRoutesOptions = {},
): void {
  const getServices = createAvailabilityServiceFactory(connection, cache);
  // Tightest budget in the system (this card's security check) — strictly
  // below `loginLimiter` (10/60s) and `resetLimiter` (5/60s) in `app.ts`.
  const limiter = new SlidingWindowRateLimiter(options.rateLimit?.limit ?? 3, options.rateLimit?.windowMs ?? 60_000);

  app.get<{ Params: { slug: string }; Querystring: { resourceId?: string; from?: string; to?: string } }>(
    "/v1/m/:slug/availability",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(
          request,
          reply,
          429,
          problemType("rate-limited"),
          "Too Many Requests",
          "Too many availability requests. Try again later.",
        );
      }

      const { resourceId, from, to } = request.query;
      if (!resourceId || !from || !to) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "resourceId, from, and to are required query parameters.",
        );
      }

      const { merchants, availability } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      try {
        const ctx = createTenantContext(merchant.id);
        const free = availability.getResourceAvailability(ctx, resourceId, from, to, new Date().toISOString());
        return reply.code(200).send({ free });
      } catch (error) {
        if (error instanceof AvailabilityRangeTooLargeError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        if (error instanceof ResourceNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
        }
        throw error;
      }
    },
  );
}
