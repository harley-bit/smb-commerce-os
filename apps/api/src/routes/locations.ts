import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type MerchantAction } from "@smb-os/domain";
import { LocationRepository, runSqliteMigrations, type Connection } from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

/** Same defense-in-depth posture as `./resources.ts`'s `requireAction`. */
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
 * Mirrors `./resources.ts`'s lazy-migration factory pattern.
 */
function createServiceFactory(connection: Connection): () => Promise<LocationRepository> {
  let ready: Promise<LocationRepository> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => new LocationRepository(connection));
    return ready;
  };
}

/**
 * `docs/cards/D112.md` — Resources and availability editor. No route ever
 * listed a merchant's own locations before this card; the editor needs a
 * location's `timezone` (`LocationRepository`) to render a resource's
 * weekly rules in the merchant's own local time rather than raw UTC, so
 * this is the minimal read surface that unblocks it. Read-only, gated by
 * the same `catalog:view` action every other read-only catalog route uses.
 */
export function registerLocationRoutes(app: FastifyInstance, connection: Connection): void {
  const getRepo = createServiceFactory(connection);

  app.get("/locations", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAction(request, reply, "catalog:view")) {
      return reply;
    }
    const repo = await getRepo();
    return reply.code(200).send(repo.list(request.auth!.tenant));
  });
}
