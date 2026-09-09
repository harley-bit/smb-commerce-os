import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ForbiddenActionError } from "@smb-os/domain";
import {
  AuditLogRepository,
  MerchantUserRepository,
  MerchantUserService,
  runSqliteMigrations,
  type MerchantUser,
  type MerchantUserRole,
  type RoleChangeNotifier,
  type Connection,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

const VALID_ROLES: readonly MerchantUserRole[] = ["OWNER", "ADMIN", "STAFF", "READ_ONLY"];

/** Lazily migrates `connection` on first use — same pattern as every other route module in this file's sibling files. */
function createServiceFactory(
  connection: Connection,
  notifyOwner: RoleChangeNotifier,
): () => Promise<MerchantUserService> {
  let ready: Promise<MerchantUserService> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(
      () => new MerchantUserService(new MerchantUserRepository(connection), new AuditLogRepository(connection), notifyOwner),
    );
    return ready;
  };
}

function handleForbidden(request: FastifyRequest, reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ForbiddenActionError) {
    sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
    return true;
  }
  return false;
}

/**
 * `docs/cards/D120.md` — Settings and team, Gate G6. `MerchantUserRepository`
 * (D030) already restricted role assignment to `OWNER`, but no HTTP route
 * ever exposed it, and its own file comment flagged the card's security
 * check ("role changes audit-logged and notified to owners") as an
 * untracked gap until `MerchantUserService` (this card) closed it. Both
 * routes here go through that service, never the repository directly, so
 * every role change is audit-logged and every current OWNER notified
 * before this route returns.
 */
export function registerTeamRoutes(app: FastifyInstance, connection: Connection, notifyOwner: RoleChangeNotifier): void {
  const getService = createServiceFactory(connection, notifyOwner);

  app.get("/team", { preHandler: app.authenticate }, async (request, reply) => {
    const service = await getService();
    try {
      const members: MerchantUser[] = service.list(request.auth!.tenant, request.auth!.role);
      return reply.code(200).send(members);
    } catch (error) {
      if (handleForbidden(request, reply, error)) {
        return reply;
      }
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/team/role-assignments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: unknown; role?: unknown };
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "userId is required.");
    }
    if (typeof body.role !== "string" || !VALID_ROLES.includes(body.role as MerchantUserRole)) {
      return sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        `role must be one of: ${VALID_ROLES.join(", ")}.`,
      );
    }

    const service = await getService();
    try {
      service.assignRole(
        request.auth!.tenant,
        request.auth!.role,
        request.auth!.identity.userId,
        body.userId,
        body.role as MerchantUserRole,
        new Date().toISOString(),
      );
      return reply.code(204).send();
    } catch (error) {
      if (handleForbidden(request, reply, error)) {
        return reply;
      }
      throw error;
    }
  });
}
