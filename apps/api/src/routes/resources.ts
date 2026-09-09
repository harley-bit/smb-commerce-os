import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import {
  AvailabilityExceptionRepository,
  AvailabilityRuleRepository,
  CrossTenantResourceAssignmentError,
  ListingRepository,
  ListingResourceRepository,
  ResourceRepository,
  ResourceService,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { assignListingResourceInputSchema, createResourceInputSchema } from "@smb-os/contracts";
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
}

/**
 * Mirrors `./variants.ts`'s `createServiceFactory` lazy-migration pattern —
 * `buildApp()` is synchronous, migrations are not.
 */
function createServiceFactory(connection: Connection): () => Promise<Services> {
  let ready: Promise<Services> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const listings = new ListingRepository(connection);
      return {
        resourceService: new ResourceService(
          new ResourceRepository(connection),
          new AvailabilityRuleRepository(connection),
          new AvailabilityExceptionRepository(connection),
          new ListingResourceRepository(connection),
          listings,
        ),
        listings,
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
export function registerResourceRoutes(app: FastifyInstance, connection: Connection): void {
  const getServices = createServiceFactory(connection);

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
}
