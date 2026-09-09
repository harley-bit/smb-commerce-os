import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertCan, ForbiddenActionError, type ConnectAccountProvider } from "@smb-os/domain";
import { ConnectOnboardingService, MerchantRepository, runSqliteMigrations, type Connection } from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

interface ConnectRouteServices {
  merchants: MerchantRepository;
  onboarding: ConnectOnboardingService;
}

/** Lazily migrates `connection` on first use — same pattern as `./merchants.ts`/`./listings.ts`. */
function createServiceFactory(connection: Connection, provider: ConnectAccountProvider): () => Promise<ConnectRouteServices> {
  let ready: Promise<ConnectRouteServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      onboarding: new ConnectOnboardingService(provider),
    }));
    return ready;
  };
}

/**
 * Payouts are already the narrowest-scoped RBAC action in this codebase
 * (`payouts:manage`, OWNER-only per `docs/design/07`'s role table, D097)
 * — starting/checking Connect onboarding is a payouts concern, so it
 * reuses that action rather than adding a new one.
 */
function requirePayoutsManage(request: FastifyRequest, reply: FastifyReply): boolean {
  try {
    assertCan({ role: request.auth!.role }, "payouts:manage", "connect-account");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenActionError) {
      sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
      return false;
    }
    throw error;
  }
}

export interface ConnectRouteOptions {
  /** Base URL of the merchant-facing web app; used to build the hosted flow's refresh/return URLs. */
  webBaseUrl: string;
}

/**
 * `docs/cards/D104.md` — Connect onboarding UI's API support. This route
 * never collects, stores, or transmits bank details or other underwriting
 * data itself (this card's security check): the only value persisted here
 * is `merchants.connect_account_id`, an opaque identifier the provider
 * hands back — everything sensitive is entered on Stripe's own hosted
 * onboarding flow, which `ConnectAccountProvider` only ever links out to.
 */
export function registerConnectRoutes(
  app: FastifyInstance,
  connection: Connection,
  provider: ConnectAccountProvider,
  options: ConnectRouteOptions,
): void {
  const getServices = createServiceFactory(connection, provider);

  app.post("/connect/onboarding", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requirePayoutsManage(request, reply)) {
      return reply;
    }
    const { tenant, identity } = request.auth!;
    const services = await getServices();

    const merchant = services.merchants.findOwn(tenant);
    if (!merchant?.businessCountry) {
      return sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        "The merchant's business address must be completed before starting payouts onboarding.",
      );
    }

    const result = await services.onboarding.startOnboarding({
      tenantId: tenant.merchantId,
      country: merchant.businessCountry,
      email: identity.email,
      refreshUrl: `${options.webBaseUrl}/dashboard/payments?merchantId=${tenant.merchantId}`,
      returnUrl: `${options.webBaseUrl}/dashboard/payments?merchantId=${tenant.merchantId}`,
    });

    services.merchants.update(tenant, { connectAccountId: result.accountId });

    return reply.code(200).send({ onboardingUrl: result.onboardingUrl, expiresAt: result.expiresAt });
  });

  app.get("/connect/status", { preHandler: app.authenticate }, async (request, reply) => {
    if (!requirePayoutsManage(request, reply)) {
      return reply;
    }
    const { tenant } = request.auth!;
    const services = await getServices();

    const merchant = services.merchants.findOwn(tenant);
    if (!merchant?.connectAccountId) {
      return reply.code(200).send({ status: "NOT_STARTED" });
    }

    const result = await services.onboarding.checkStatus(merchant.connectAccountId);
    return reply.code(200).send(result);
  });
}
