import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthProvider } from "@smb-os/domain";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import {
  LocationRepository,
  MerchantRepository,
  MerchantUserRepository,
  UserRepository,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { onboardMerchantInputSchema } from "@smb-os/contracts";
import { problemType, sendProblem } from "../problemDetails.js";

const SESSION_COOKIE = "session";

/** `a-z0-9` words joined by single hyphens — never leading/trailing/doubled. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Services {
  merchants: MerchantRepository;
  merchantUsers: MerchantUserRepository;
  locations: LocationRepository;
  users: UserRepository;
}

/** Mirrors `./listings.ts`'s lazy-migration factory: `buildApp()` is synchronous, migrations are not. */
function createServiceFactory(connection: Connection): () => Promise<Services> {
  let ready: Promise<Services> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      merchantUsers: new MerchantUserRepository(connection),
      locations: new LocationRepository(connection),
      users: new UserRepository(connection),
    }));
    return ready;
  };
}

/**
 * Onboarding is deliberately not gated by `app.authenticate`: that
 * decorator requires an `X-Merchant-Id` the caller is already a member
 * of, which is exactly what doesn't exist yet for a brand-new merchant.
 * This route only needs to know *who* is calling (a verified session),
 * per `docs/design/06`'s narrower "session-authenticated, not yet
 * tenant-scoped" case — the same shape `GET /auth/me` already uses.
 */
async function requireSession(
  authProvider: AuthProvider,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ userId: string; email: string } | null> {
  const token = request.cookies[SESSION_COOKIE];
  const identity = token ? await authProvider.verifySession(token) : null;
  if (!identity) {
    sendProblem(request, reply, 401, problemType("unauthorized"), "Unauthorized", "A valid session is required.");
    return null;
  }
  return identity;
}

/**
 * `apps/api`'s native auth store (`./auth/repositories.ts`) is a D010
 * placeholder, still not wired to `@smb-os/db` end-to-end (see that
 * file's own comment) — its user ids live in a different id space than
 * `@smb-os/db`'s `users` table, which `merchant_users.user_id` actually
 * references. `users.external_auth_id` exists precisely to bridge that
 * (`docs/design/03`), so onboarding finds-or-creates the DB-side user by
 * email here rather than assuming `identity.userId` is already a `users`
 * row. This is the one place that bridge needs to exist for D103's
 * acceptance criterion ("a new merchant completes setup unaided") to
 * hold end-to-end; it is not a general auth fix, and does not change how
 * any other route resolves identity.
 */
function findOrCreateDbUser(
  users: UserRepository,
  identity: { userId: string; email: string },
  createdAt: string,
): string {
  const existing = users.findByEmail(identity.email);
  if (existing) {
    return existing.id;
  }
  return users.create({ email: identity.email, externalAuthId: identity.userId, status: "ACTIVE", createdAt });
}

export function registerMerchantRoutes(app: FastifyInstance, connection: Connection, authProvider: AuthProvider): void {
  const getServices = createServiceFactory(connection);

  app.post<{ Body: unknown }>("/merchants", async (request, reply) => {
    const identity = await requireSession(authProvider, request, reply);
    if (!identity) {
      return reply;
    }

    const parsed = onboardMerchantInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", parsed.error.message);
    }
    const input = parsed.data;

    const services = await getServices();
    const createdAt = new Date().toISOString();
    const merchantId = generateUuidV7();
    const ctx = createTenantContext(merchantId);

    let slug = input.slug ? slugify(input.slug) : slugify(input.businessName);
    if (!slug) {
      slug = merchantId;
    }
    while (services.merchants.findBySlug(slug)) {
      slug = `${slug}-${generateUuidV7().slice(0, 8)}`;
    }

    services.merchants.create(ctx, {
      name: input.businessName,
      slug,
      status: "ACTIVE",
      defaultCurrency: input.defaultCurrency,
      createdAt,
      legalName: input.legalName,
      taxId: input.taxId,
      businessAddressLine1: input.businessAddress.addressLine1,
      businessAddressLine2: input.businessAddress.addressLine2,
      businessCity: input.businessAddress.city,
      businessState: input.businessAddress.state,
      businessPostalCode: input.businessAddress.postalCode,
      businessCountry: input.businessAddress.country,
    });

    const dbUserId = findOrCreateDbUser(services.users, identity, createdAt);
    // Bootstrap: onboarding is the one place a merchant's first OWNER is
    // assigned with no pre-existing member to have granted it — the acting
    // and target role are the same self-assignment, not a privilege escalation.
    services.merchantUsers.assignRole(ctx, "OWNER", dbUserId, "OWNER", createdAt);

    const locationId = services.locations.create(ctx, {
      name: input.location.name,
      timezone: input.location.timezone,
      addressLine1: input.location.addressLine1,
      addressLine2: input.location.addressLine2,
      city: input.location.city,
      state: input.location.state,
      postalCode: input.location.postalCode,
      country: input.location.country,
    });

    return reply.code(201).send({ merchantId, slug, locationId });
  });
}
