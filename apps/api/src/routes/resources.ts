import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import {
  AvailabilityCache,
  AvailabilityExceptionRepository,
  AvailabilityRangeTooLargeError,
  AvailabilityRuleRepository,
  AvailabilityService,
  CrossTenantResourceAssignmentError,
  ListingRepository,
  ListingResourceRepository,
  LocationRepository,
  ReservationRepository,
  ResourceNotFoundError,
  ResourceRepository,
  ResourceService,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import {
  assignListingResourceInputSchema,
  createAvailabilityExceptionInputSchema,
  createAvailabilityRuleInputSchema,
  createResourceInputSchema,
} from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * Same defense-in-depth posture as `./variants.ts`'s `requireAction`:
 * `ResourceService` already re-asserts `assertCanManageCatalog` internally,
 * but every route still gets its own explicit check.
 */
function requireAction(request: FastifyRequest, reply: FastifyReply, action: MerchantAction): boolean {
  try {
    assertCan({ role: request.auth!.role }, action, "listing");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenActionError) {
      sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
      return false;
    }
    throw error;
  }
}

interface Services {
  resourceService: ResourceService;
  listings: ListingRepository;
  availabilityService: AvailabilityService;
}

/**
 * Mirrors `./variants.ts`'s `createServiceFactory` lazy-migration pattern —
 * `buildApp()` is synchronous, migrations are not.
 */
function createServiceFactory(connection: Connection, cache: AvailabilityCache): () => Promise<Services> {
  let ready: Promise<Services> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const listings = new ListingRepository(connection);
      const resources = new ResourceRepository(connection);
      const rules = new AvailabilityRuleRepository(connection);
      const exceptions = new AvailabilityExceptionRepository(connection);
      return {
        resourceService: new ResourceService(
          resources,
          rules,
          exceptions,
          new ListingResourceRepository(connection),
          listings,
        ),
        listings,
        // Same cache `./availability.ts`'s public route and `./bookings.ts`
        // read/invalidate — this card's authenticated read must never serve
        // availability staler than what a real reservation write just
        // invalidated (D112 reuses the D061/D062 cache-consistency posture).
        availabilityService: new AvailabilityService(
          resources,
          new LocationRepository(connection),
          rules,
          exceptions,
          new ReservationRepository(connection, cache),
          cache,
        ),
      };
    });
    return ready;
  };
}

/**
 * `docs/cards/D107.md` — "SERVICE listings: duration, resources, policy."
 * `ResourceService` (D058) and `ListingResourceRepository` (D107) already
 * existed/were added this card with no HTTP surface — same gap D106 closed
 * for `VariantService`. `POST /resources` creates a bookable subject
 * (staff/room/equipment); `GET`/`POST /listings/:listingId/resources`
 * manage the join this card's security check is about — "resource
 * assignment respects tenant scope," enforced by `ResourceService.
 * assignListingResource` re-resolving both the listing and the resource
 * under the acting tenant's own `ctx` before ever writing the join row.
 */
export function registerResourceRoutes(
  app: FastifyInstance,
  connection: Connection,
  cache: AvailabilityCache = new AvailabilityCache(),
): void {
  const getServices = createServiceFactory(connection, cache);

  app.get("/resources", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAction(request, reply, "catalog:view")) {
      return reply;
    }
    const { resourceService } = await getServices();
    return reply.code(200).send(resourceService.listResources(request.auth!.tenant));
  });

  app.post<{ Body: unknown }>("/resources", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAction(request, reply, "catalog:manage")) {
      return reply;
    }
    const parsed = createResourceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
    }
    const { resourceService } = await getServices();
    const id = resourceService.createResource(request.auth!.tenant, request.auth!.role, parsed.data);
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { listingId: string } }>(
    "/listings/:listingId/resources",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const { resourceService, listings } = await getServices();
      const listing = listings.findById(request.auth!.tenant, request.params.listingId);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      return reply.code(200).send(resourceService.listListingResources(request.auth!.tenant, listing.id));
    },
  );

  app.post<{ Params: { listingId: string }; Body: unknown }>(
    "/listings/:listingId/resources",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const { resourceService, listings } = await getServices();
      const listing = listings.findById(request.auth!.tenant, request.params.listingId);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      const parsed = assignListingResourceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      try {
        const id = resourceService.assignListingResource(request.auth!.tenant, request.auth!.role, {
          listingId: listing.id,
          resourceId: parsed.data.resourceId,
          createdAt: new Date().toISOString(),
        });
        return reply.code(201).send({ id });
      } catch (error) {
        if (error instanceof CrossTenantResourceAssignmentError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
        }
        throw error;
      }
    },
  );

  /**
   * `docs/cards/D112.md` deliverable — "Weekly rules per resource."
   * `ResourceService.createAvailabilityRule`/`listAvailabilityRules`
   * (D058) already existed with no HTTP surface, same gap D106/D107 closed
   * for variants/resource-assignment. `resourceId` is always taken from the
   * URL, never trusted from the body — the parsed body's own `resourceId`
   * (if any) is overwritten before validation, the same "path is the
   * source of truth" posture `./variants.ts` uses for `listingId`/`mode`.
   */
  app.get<{ Params: { resourceId: string } }>(
    "/resources/:resourceId/availability-rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const { resourceService } = await getServices();
      const resource = resourceService.findResourceById(request.auth!.tenant, request.params.resourceId);
      if (!resource) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
      }
      return reply.code(200).send(resourceService.listAvailabilityRules(request.auth!.tenant, resource.id));
    },
  );

  app.post<{ Params: { resourceId: string }; Body: unknown }>(
    "/resources/:resourceId/availability-rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const { resourceService } = await getServices();
      const resource = resourceService.findResourceById(request.auth!.tenant, request.params.resourceId);
      if (!resource) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
      }
      const body = typeof request.body === "object" && request.body !== null ? request.body : {};
      const parsed = createAvailabilityRuleInputSchema.safeParse({ ...body, resourceId: resource.id });
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      const id = resourceService.createAvailabilityRule(request.auth!.tenant, request.auth!.role, parsed.data);
      return reply.code(201).send({ id });
    },
  );

  /**
   * `docs/cards/D113.md` deliverable — "Blackouts and extra openings."
   * `ResourceService.createAvailabilityException`/`listAvailabilityExceptions`
   * (D058) already existed with no HTTP surface, same gap D112 closed for
   * weekly rules. Same "path is the source of truth" posture: `resourceId`
   * is always taken from the URL, never trusted from the body. Security
   * check — "Merchant-scoped only": the resource is re-resolved under the
   * acting tenant's own `ctx` before either verb touches an exception row,
   * so a caller cannot list or create exceptions against a resource id that
   * belongs to another merchant, even if that id genuinely exists.
   */
  app.get<{ Params: { resourceId: string } }>(
    "/resources/:resourceId/availability-exceptions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const { resourceService } = await getServices();
      const resource = resourceService.findResourceById(request.auth!.tenant, request.params.resourceId);
      if (!resource) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
      }
      return reply.code(200).send(resourceService.listAvailabilityExceptions(request.auth!.tenant, resource.id));
    },
  );

  app.post<{ Params: { resourceId: string }; Body: unknown }>(
    "/resources/:resourceId/availability-exceptions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const { resourceService } = await getServices();
      const resource = resourceService.findResourceById(request.auth!.tenant, request.params.resourceId);
      if (!resource) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No resource with that id.");
      }
      const body = typeof request.body === "object" && request.body !== null ? request.body : {};
      const parsed = createAvailabilityExceptionInputSchema.safeParse({ ...body, resourceId: resource.id });
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      const id = resourceService.createAvailabilityException(request.auth!.tenant, request.auth!.role, parsed.data);
      return reply.code(201).send({ id });
    },
  );

  /**
   * `docs/cards/D112.md` acceptance criterion — "Availability renders
   * correctly in merchant timezone" — and security check — "Timezone
   * handling verified across DST." This is an authenticated counterpart to
   * `./availability.ts`'s public `GET /v1/m/:slug/availability`: same
   * `AvailabilityService.getResourceAvailability` call (already DST-correct
   * via `packages/domain`'s `expandAvailabilityRule`, resolving each
   * interval's offset from the *resource's own location* timezone, not a
   * caller-supplied one), reached via the merchant's own session instead of
   * a public slug + rate limiter, for the dashboard editor to read back
   * what it just configured.
   */
  app.get<{ Params: { resourceId: string }; Querystring: { from?: string; to?: string } }>(
    "/resources/:resourceId/availability",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const { from, to } = request.query;
      if (!from || !to) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "from and to are required query parameters.",
        );
      }
      const { availabilityService } = await getServices();
      try {
        const free = availabilityService.getResourceAvailability(
          request.auth!.tenant,
          request.params.resourceId,
          from,
          to,
          new Date().toISOString(),
        );
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
