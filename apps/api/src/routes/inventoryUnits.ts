import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import {
  runSqliteMigrations,
  AuditLogRepository,
  InventoryUnitRepository,
  InventoryUnitService,
  ReservationRepository,
  VariantRepository,
  VariantService,
  type Connection,
} from "@smb-os/db";
import { createInventoryUnitInputSchema, updateInventoryUnitInputSchema } from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

/**
 * Same defense-in-depth posture as `./variants.ts`'s `requireAction`:
 * `InventoryUnitService`'s own methods already re-assert `inventory:manage`
 * internally, but every route still gets its own explicit check.
 */
function requireAction(request: FastifyRequest, reply: FastifyReply, action: MerchantAction): boolean {
  try {
    assertCan({ role: request.auth!.role }, action, "inventory_unit");
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
  variantService: VariantService;
  unitService: InventoryUnitService;
  unitRepo: InventoryUnitRepository;
}

/** Mirrors `./variants.ts`'s lazy-migration `createServiceFactory` pattern. */
function createServiceFactory(connection: Connection): () => Promise<Services> {
  let ready: Promise<Services> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const unitRepo = new InventoryUnitRepository(connection);
      return {
        variantService: new VariantService(new VariantRepository(connection)),
        unitService: new InventoryUnitService(
          unitRepo,
          new AuditLogRepository(connection),
          new ReservationRepository(connection),
        ),
        unitRepo,
      };
    });
    return ready;
  };
}

/**
 * A variant's own listing must match the URL's `:listingId`, mirroring
 * `./variants.ts`'s "no cross-listing/cross-tenant attach" defense — a
 * caller cannot address a unit or create one for a variant that belongs to
 * a different listing (or a different merchant, since `VariantService`'s
 * own lookup is already tenant-scoped and returns nothing for another
 * merchant's variant).
 */
async function resolveVariant(
  request: FastifyRequest<{ Params: { listingId: string; variantId: string } }>,
  reply: FastifyReply,
  services: Services,
): Promise<{ id: string } | null> {
  const variant = services.variantService.findById(request.auth!.tenant, request.params.variantId);
  if (!variant || variant.listingId !== request.params.listingId) {
    sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No variant with that id.");
    return null;
  }
  return variant;
}

export function registerInventoryUnitRoutes(app: FastifyInstance, connection: Connection): void {
  const getServices = createServiceFactory(connection);

  app.get<{ Params: { listingId: string; variantId: string } }>(
    "/listings/:listingId/variants/:variantId/units",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "inventory:view")) {
        return reply;
      }
      const services = await getServices();
      const variant = await resolveVariant(request, reply, services);
      if (!variant) {
        return reply;
      }
      // `docs/cards/D111.md` — rental status is computed on every read, not
      // stored on the unit itself; see `InventoryUnitService.listWithRentalStatus`.
      const units = services.unitService.listWithRentalStatus(
        request.auth!.tenant,
        request.auth!.role,
        variant.id,
        new Date().toISOString(),
      );
      return reply.code(200).send(units);
    },
  );

  app.post<{ Params: { listingId: string; variantId: string }; Body: unknown }>(
    "/listings/:listingId/variants/:variantId/units",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "inventory:manage")) {
        return reply;
      }
      const services = await getServices();
      const variant = await resolveVariant(request, reply, services);
      if (!variant) {
        return reply;
      }

      // `variantId` is never taken from the request body — forced from the
      // already-resolved, tenant-scoped variant, the same "don't trust the
      // client to name its own parent" rule `./variants.ts` applies to
      // `mode`/`listingId`.
      const candidate = { ...(request.body as Record<string, unknown>), variantId: variant.id };
      const parsed = createInventoryUnitInputSchema.safeParse(candidate);
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      const id = services.unitService.create(request.auth!.tenant, request.auth!.role, parsed.data);
      return reply.code(201).send({ id });
    },
  );

  app.put<{ Params: { listingId: string; variantId: string; unitId: string }; Body: unknown }>(
    "/listings/:listingId/variants/:variantId/units/:unitId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "inventory:manage")) {
        return reply;
      }
      const services = await getServices();
      const variant = await resolveVariant(request, reply, services);
      if (!variant) {
        return reply;
      }
      const unit = services.unitRepo.findById(request.auth!.tenant, request.params.unitId);
      if (!unit || unit.variantId !== variant.id) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No inventory unit with that id.");
      }

      // `.strict()` in `updateInventoryUnitInputSchema` rejects a body
      // carrying `acquisitionCostMinor`/`acquiredAt`/`status` outright —
      // this card's security check, "acquisition data captured now,
      // impossible to backfill."
      const parsed = updateInventoryUnitInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
      }
      services.unitService.update(request.auth!.tenant, request.auth!.role, unit.id, parsed.data);
      return reply.code(200).send({ id: unit.id });
    },
  );

  app.post<{ Params: { listingId: string; variantId: string; unitId: string }; Body: unknown }>(
    "/listings/:listingId/variants/:variantId/units/:unitId/retire",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requireAction(request, reply, "inventory:manage")) {
        return reply;
      }
      const services = await getServices();
      const variant = await resolveVariant(request, reply, services);
      if (!variant) {
        return reply;
      }
      const unit = services.unitRepo.findById(request.auth!.tenant, request.params.unitId);
      if (!unit || unit.variantId !== variant.id) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No inventory unit with that id.");
      }

      const body = (request.body as { note?: string } | null) ?? {};
      try {
        services.unitService.transitionStatus(request.auth!.tenant, request.auth!.role, {
          unitId: unit.id,
          newStatus: "RETIRED",
          actorUserId: request.auth!.identity.userId,
          note: body.note ?? "",
          occurredAt: new Date().toISOString(),
        });
      } catch (error) {
        return sendProblem(
          request,
          reply,
          409,
          problemType("conflict"),
          "Conflict",
          (error as Error).message,
        );
      }
      return reply.code(200).send({ id: unit.id });
    },
  );
}
