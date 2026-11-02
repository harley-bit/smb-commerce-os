import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import {
  runSqliteMigrations,
  ListingRepository,
  ListingService,
  type Connection,
} from "@smb-os/db";
import { createListingInputSchema, updateListingInputSchema } from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * `docs/design/07`'s per-role scope table names `catalog:view` (all
 * merchant roles) and `catalog:manage` (`OWNER`/`ADMIN` only) as the two
 * actions covering these routes. `ListingService.create/update/archive`
 * (D023) already re-asserts `OWNER`/`ADMIN` internally via its own
 * `assertCanManageCatalog` — checking here too, with `packages/domain`'s
 * `rbac.ts` (D037), is deliberate defense in depth and gives every route
 * its own explicit authorization check, per this card's acceptance
 * criterion ("authorization test per route"), rather than relying solely
 * on a service-layer side effect.
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

/**
 * Lazily migrates `connection` (idempotent per D015) on first use, then
 * hands back the same `ListingService` for every subsequent route call —
 * mirrors `./auth/authenticate.ts`'s `createDefaultMembershipResolver`
 * lazy-migration pattern for the same reason: `buildApp()` is synchronous,
 * migrations are not.
 */
function createListingServiceFactory(connection: Connection): () => Promise<ListingService> {
  let ready: Promise<ListingService> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => new ListingService(new ListingRepository(connection)));
    return ready;
  };
}

export function registerListingRoutes(app: FastifyInstance, connection: Connection): void {
  const getService = createListingServiceFactory(connection);

  app.get("/listings", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAction(request, reply, "catalog:view")) {
      return reply;
    }
    const service = await getService();
    return reply.code(200).send(service.list(request.auth!.tenant));
  });

  app.get<{ Params: { id: string } }>(
    "/listings/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:view")) {
        return reply;
      }
      const service = await getService();
      const listing = service.findById(request.auth!.tenant, request.params.id);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      return reply.code(200).send(listing);
    },
  );

  app.post<{ Body: unknown }>("/listings", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAction(request, reply, "catalog:manage")) {
      return reply;
    }
    const parsed = createListingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
    }
    const service = await getService();
    const id = service.create(request.auth!.tenant, request.auth!.role, parsed.data);
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/listings/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const parsed = updateListingInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      const service = await getService();
      const existing = service.findById(request.auth!.tenant, request.params.id);
      if (!existing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      service.update(request.auth!.tenant, request.auth!.role, request.params.id, parsed.data);
      return reply.code(200).send(service.findById(request.auth!.tenant, request.params.id));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/listings/:id/archive",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "catalog:manage")) {
        return reply;
      }
      const service = await getService();
      const existing = service.findById(request.auth!.tenant, request.params.id);
      if (!existing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that id.");
      }
      service.archive(request.auth!.tenant, request.auth!.role, request.params.id, new Date().toISOString());
      return reply.code(200).send(service.findById(request.auth!.tenant, request.params.id));
    },
  );
}
