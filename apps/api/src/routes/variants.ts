import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import {
  runSqliteMigrations,
  ListingRepository,
  ListingService,
  VariantRepository,
  VariantService,
  type Connection,
} from "@smb-os/db";
import { createVariantInputSchema } from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * Same defense-in-depth posture as `./listings.ts`'s `requireAction`:
 * `VariantService.create/update/archive` already re-asserts `OWNER`/`ADMIN`
 * internally via `assertCanManageCatalog`, but every route still gets its
 * own explicit check.
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
  listingService: ListingService;
  variantService: VariantService;
}

/**
 * Mirrors `./listings.ts`'s `createListingServiceFactory` lazy-migration
 * pattern — `buildApp()` is synchronous, migrations are not.
 */
function createServiceFactory(connection: Connection): () => Promise<Services> {
  let ready: Promise<Services> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      listingService: new ListingService(new ListingRepository(connection)),
      variantService: new VariantService(new VariantRepository(connection)),
    }));
    return ready;
  };
}

export function registerVariantRoutes(app: FastifyInstance, connection: Connection): void {
  const getServices = createServiceFactory(connection);

  app.get<{ Params: { listingId: string } }>(
    "/listings/:listingId/variants",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const { listingService, variantService } = await getServices();
      const listing = listingService.findById(request.auth!.tenant, request.params.listingId);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      return reply.code(200).send(variantService.listByListing(request.auth!.tenant, request.params.listingId));
    },
  );

  app.post<{ Params: { listingId: string }; Body: unknown }>(
    "/listings/:listingId/variants",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const { listingService, variantService } = await getServices();
      const listing = listingService.findById(request.auth!.tenant, request.params.listingId);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }

      // `mode`/`listingId` are never taken from the request body — a caller
      // could otherwise attach a variant to a different listing's id, or
      // pick a mode other than the parent listing's real one to smuggle
      // mode-forbidden fields (e.g. a RENTAL `depositMinor`) past validation.
      const candidate = {
        ...(request.body as Record<string, unknown>),
        listingId: listing.id,
        mode: listing.mode,
      };
      const parsed = createVariantInputSchema.safeParse(candidate);
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      const id = variantService.create(request.auth!.tenant, request.auth!.role, parsed.data);
      return reply.code(201).send({ id });
    },
  );
}
