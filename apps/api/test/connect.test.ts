import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  MerchantRepository,
  MerchantUserRepository,
  SimulatedConnectAccountProvider,
  UserRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
  type MerchantUserRole,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  provider: SimulatedConnectAccountProvider;
  headers: Record<string, string>;
  app: FastifyInstance;
}

async function setupFixture(role: MerchantUserRole, businessCountry: string | null = "US"): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  merchants.create(ctx, {
    name: "acme",
    slug: `acme-${generateUuidV7()}`,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
    ...(businessCountry ? { businessCountry } : {}),
  });
  const merchantId = ctx.merchantId;

  const dbUsers = new UserRepository(connection);
  const userId = dbUsers.create({ email: "owner@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(connection);
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);

  const identity: AuthIdentity = { userId, email: "owner@example.com", roles: [role] };
  const fakeAuthProvider: AuthProvider = {
    register: () => Promise.reject(new Error("not implemented")),
    authenticate: () => Promise.reject(new Error("not implemented")),
    createSession: () => Promise.reject(new Error("not implemented")),
    verifySession: (token) => Promise.resolve(token === "valid-token" ? identity : null),
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

  const provider = new SimulatedConnectAccountProvider();
  const app = buildApp({
    authProvider: fakeAuthProvider,
    merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    connection,
    connectAccountProvider: provider,
  });

  return {
    connection,
    merchantId,
    provider,
    headers: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    app,
  };
}

describe("Connect onboarding routes (D104)", () => {
  it("GET /connect/status reports NOT_STARTED before onboarding begins", async () => {
    const { app, headers } = await setupFixture("OWNER");

    const response = await app.inject({ method: "GET", url: "/connect/status", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "NOT_STARTED" });
  });

  it("a merchant reaches the payouts-enabled state: start onboarding, complete the hosted flow, then status reports ACTIVE", async () => {
    const { app, headers, provider, connection, merchantId } = await setupFixture("OWNER");

    const start = await app.inject({ method: "POST", url: "/connect/onboarding", headers });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { onboardingUrl: string; expiresAt: string };
    expect(startBody.onboardingUrl).toContain("connect.simulated.stripe.example");

    const midway = await app.inject({ method: "GET", url: "/connect/status", headers });
    expect(midway.json()).toMatchObject({ status: "ONBOARDING", payoutsEnabled: false });

    const merchant = new MerchantRepository(connection).findOwn(createTenantContext(merchantId));
    expect(merchant?.connectAccountId).toBeTruthy();
    provider.simulateOnboardingCompleted(merchant!.connectAccountId!);

    const after = await app.inject({ method: "GET", url: "/connect/status", headers });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true });
  });

  it("rejects onboarding for a role without payouts:manage", async () => {
    const { app, headers } = await setupFixture("STAFF");

    const response = await app.inject({ method: "POST", url: "/connect/onboarding", headers });

    expect(response.statusCode).toBe(403);
  });

  it("rejects starting onboarding before the merchant's business address is complete", async () => {
    const { app, headers } = await setupFixture("OWNER", null);

    const response = await app.inject({ method: "POST", url: "/connect/onboarding", headers });

    expect(response.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = await setupFixture("OWNER");

    const response = await app.inject({ method: "GET", url: "/connect/status" });

    expect(response.statusCode).toBe(401);
  });
});
