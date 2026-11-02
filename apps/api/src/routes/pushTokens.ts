import type { FastifyInstance } from "fastify";
import { createTenantContext, type AuthProvider } from "@smb-os/domain";
import { MerchantRepository, PushDeviceTokenRepository, runSqliteMigrations, type Connection } from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";
import { extractSessionToken } from "../auth/sessionToken.js";

interface PushTokenServices {
  merchants: MerchantRepository;
  tokens: PushDeviceTokenRepository;
}

/** Lazily migrates `connection` on first use — same pattern as `./customerOrders.ts`. */
function createServiceFactory(connection: Connection): () => Promise<PushTokenServices> {
  let ready: Promise<PushTokenServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      tokens: new PushDeviceTokenRepository(connection),
    }));
    return ready;
  };
}

interface RegisterPushTokenBody {
  token?: unknown;
  platform?: unknown;
}

/**
 * `docs/cards/D148.md` — "Push notifications". Same session-check shape as
 * `./customerOrders.ts`'s routes: a mobile customer authenticates via the
 * `Authorization: Bearer` session token (`extractSessionToken`, D138), never
 * a client-supplied customer id, so a device token can only ever be
 * registered against the identity that owns the session presenting it.
 */
export function registerPushTokenRoutes(app: FastifyInstance, connection: Connection, authProvider: AuthProvider): void {
  const getServices = createServiceFactory(connection);

  app.post<{ Params: { slug: string }; Body: RegisterPushTokenBody }>(
    "/v1/m/:slug/account/push-tokens",
    async (request, reply) => {
      const token = extractSessionToken(request);
      const identity = token ? await authProvider.verifySession(token) : null;
      if (!identity) {
        return sendProblem(
          request,
          reply,
          401,
          problemType("unauthorized"),
          "Unauthorized",
          "A valid session is required.",
        );
      }

      const { platform, token: deviceToken } = request.body ?? {};
      if (
        (platform !== "ios" && platform !== "android") ||
        typeof deviceToken !== "string" ||
        deviceToken.length === 0
      ) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "A non-empty device `token` and `platform` of \"ios\" or \"android\" are required.",
        );
      }

      const { merchants, tokens } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      tokens.register(ctx, {
        customerUserId: identity.userId,
        platform,
        token: deviceToken,
        createdAt: new Date().toISOString(),
      });
      return reply.code(204).send();
    },
  );
}
