import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  MerchantRepository,
  PushDeviceTokenRepository,
  UserRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { buildApp } from "../src/app";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  slug: string;
  customerUserId: string;
  app: FastifyInstance;
}

function fakeAuthProvider(identityByToken: Map<string, AuthIdentity>): AuthProvider {
  return {
    register: () => Promise.reject(new Error("not implemented")),
    authenticate: () => Promise.reject(new Error("not implemented")),
    createSession: () => Promise.reject(new Error("not implemented")),
    verifySession: (token) => Promise.resolve(identityByToken.get(token) ?? null),
    revokeSession: () => Promise.resolve(),
    initiatePasswordReset: () => Promise.resolve(),
    completePasswordReset: () => Promise.reject(new Error("not implemented")),
    enrollMfa: () => Promise.reject(new Error("not implemented")),
    confirmMfaEnrollment: () => Promise.reject(new Error("not implemented")),
    createAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    exchangeAuthorizationCode: () => Promise.reject(new Error("not implemented")),
    refreshMobileSession: () => Promise.reject(new Error("not implemented")),
    revokeMobileSession: () => Promise.resolve(),
  };
}

async function setupFixture(): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const merchantId = generateUuidV7();
  const ctx = createTenantContext(merchantId);
  const slug = `merchant-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Merchant",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });

  const users = new UserRepository(connection);
  const customerUserId = users.create({ email: "customer@example.com", status: "ACTIVE", createdAt: CREATED_AT });

  const identityByToken = new Map<string, AuthIdentity>([
    ["customer-token", { userId: customerUserId, email: "customer@example.com", roles: [] }],
  ]);

  const app = buildApp({ authProvider: fakeAuthProvider(identityByToken), connection });

  return { connection, merchantId, slug, customerUserId, app };
}

describe("POST /v1/m/:slug/account/push-tokens (D148)", () => {
  it("rejects an unauthenticated request", async () => {
    const { app, slug } = await setupFixture();
    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/account/push-tokens`,
      payload: { token: "device-token", platform: "ios" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a malformed platform", async () => {
    const { app, slug } = await setupFixture();
    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/account/push-tokens`,
      headers: { authorization: "Bearer customer-token" },
      payload: { token: "device-token", platform: "windows-phone" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("registers an iOS token against the authenticated customer's own identity, not a client-supplied one", async () => {
    const { app, slug, connection, merchantId, customerUserId } = await setupFixture();
    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/account/push-tokens`,
      headers: { authorization: "Bearer customer-token" },
      payload: { token: "ios-device-token", platform: "ios" },
    });
    expect(response.statusCode).toBe(204);

    const tokens = new PushDeviceTokenRepository(connection);
    const ctx = createTenantContext(merchantId);
    const registered = tokens.listForCustomer(ctx, customerUserId);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.platform).toBe("ios");
    expect(registered[0]?.token).toBe("ios-device-token");
  });

  it("registers an Android token — the same route handles both platforms identically", async () => {
    const { app, slug, connection, merchantId, customerUserId } = await setupFixture();
    const response = await app.inject({
      method: "POST",
      url: `/v1/m/${slug}/account/push-tokens`,
      headers: { authorization: "Bearer customer-token" },
      payload: { token: "android-device-token", platform: "android" },
    });
    expect(response.statusCode).toBe(204);

    const tokens = new PushDeviceTokenRepository(connection);
    const ctx = createTenantContext(merchantId);
    const registered = tokens.listForCustomer(ctx, customerUserId);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.platform).toBe("android");
  });

  it("returns 404 for an unknown merchant slug", async () => {
    const { app } = await setupFixture();
    const response = await app.inject({
      method: "POST",
      url: `/v1/m/no-such-merchant/account/push-tokens`,
      headers: { authorization: "Bearer customer-token" },
      payload: { token: "device-token", platform: "ios" },
    });
    expect(response.statusCode).toBe(404);
  });
});
