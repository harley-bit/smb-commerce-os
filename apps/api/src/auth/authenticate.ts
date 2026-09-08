import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createTenantContext,
  isUuidV7,
  type AuthIdentity,
  type AuthProvider,
  type TenantContext,
} from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  MerchantUserRepository,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

const SESSION_COOKIE = "session";
const MERCHANT_HEADER = "x-merchant-id";

/**
 * What every authenticated, tenant-scoped route handler receives once this
 * middleware has run: `identity` is *who* is calling (global, no merchant
 * scope — `packages/domain`'s `AuthIdentity`), `tenant` is *which merchant's
 * data* the request may touch (`TenantContext`, the only thing a repository
 * call accepts), and `role` is that user's role within that specific
 * merchant — a user can hold different roles at different merchants via
 * `merchant_users`, so role is a property of the (user, merchant) pair, not
 * of the identity alone.
 */
export interface AuthenticatedContext {
  identity: AuthIdentity;
  tenant: TenantContext;
  role: MerchantUserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthenticatedContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Resolves whether a globally-authenticated user is a member of a given
 * merchant, and if so, their role there. Kept as a seam (rather than
 * calling `MerchantUserRepository` directly from the middleware) so tests
 * can inject an in-memory double without standing up a real connection.
 */
export interface MerchantMembershipResolver {
  resolveRole(userId: string, merchantId: string): Promise<MerchantUserRole | null>;
}

/** Real, `packages/db`-backed resolver. */
export class DbMerchantMembershipResolver implements MerchantMembershipResolver {
  private readonly repo: MerchantUserRepository;

  constructor(connection: Connection) {
    this.repo = new MerchantUserRepository(connection);
  }

  async resolveRole(userId: string, merchantId: string): Promise<MerchantUserRole | null> {
    const ctx = createTenantContext(merchantId);
    return this.repo.findRole(ctx, userId) ?? null;
  }
}

/**
 * A working default so `buildApp()` never silently no-ops: a real
 * `DbMerchantMembershipResolver` over a fresh in-memory SQLite connection,
 * migrated lazily on first use. No route in this repo writes to it yet
 * (`apps/api` has no live database wiring — `index.ts` doesn't start a
 * server against a real connection), so in practice every membership check
 * against this default resolves to "not a member" until a future card
 * wires the API to a real, shared connection. That's the honest state, not
 * a bug: this card's job is the middleware, not the DB wiring.
 */
export function createDefaultMembershipResolver(): MerchantMembershipResolver {
  const connection = createConnection(":memory:");
  let ready: Promise<DbMerchantMembershipResolver> | null = null;
  const resolver: MerchantMembershipResolver = {
    async resolveRole(userId, merchantId) {
      if (!ready) {
        ready = runSqliteMigrations(connection).then(() => new DbMerchantMembershipResolver(connection));
      }
      const real = await ready;
      return real.resolveRole(userId, merchantId);
    },
  };
  return resolver;
}

/**
 * Builds the `preHandler` every authenticated, tenant-scoped route
 * registers: verifies the session cookie (rejecting anything missing,
 * malformed, expired, or revoked with `401`), then resolves the caller's
 * membership in the merchant named by `X-Merchant-Id` (rejecting a missing
 * or malformed header with `400`, and a non-member with `403`). On success,
 * populates `request.auth` per `docs/design/06`'s "every authenticated
 * request resolves to a TenantContext before reaching a controller" rule.
 */
export function createAuthenticateHandler(
  authProvider: AuthProvider,
  membership: MerchantMembershipResolver,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const identity = token ? await authProvider.verifySession(token) : null;
    if (!identity) {
      sendProblem(request, reply, 401, problemType("unauthorized"), "Unauthorized", "A valid session is required.");
      return;
    }

    const merchantIdHeader = request.headers[MERCHANT_HEADER];
    const merchantId = Array.isArray(merchantIdHeader) ? merchantIdHeader[0] : merchantIdHeader;
    if (!merchantId || !isUuidV7(merchantId)) {
      sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        `A valid ${MERCHANT_HEADER} header is required.`,
      );
      return;
    }

    const role = await membership.resolveRole(identity.userId, merchantId);
    if (!role) {
      sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", "Not a member of this merchant.");
      return;
    }

    request.auth = { identity, tenant: createTenantContext(merchantId), role };
  };
}

export function registerAuthenticateDecorator(
  app: FastifyInstance,
  authProvider: AuthProvider,
  membership: MerchantMembershipResolver,
): void {
  app.decorate("authenticate", createAuthenticateHandler(authProvider, membership));
}
