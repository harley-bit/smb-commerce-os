import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  MerchantRepository,
  MerchantUserRepository,
  UserRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { buildApp } from "../src/app";

const VALID_PAYLOAD = {
  businessName: "Acme Rentals",
  defaultCurrency: "USD",
  legalName: "Acme Rentals LLC",
  taxId: "12-3456789",
  businessAddress: {
    addressLine1: "1 Main St",
    city: "Springfield",
    postalCode: "62701",
    country: "US",
  },
  location: {
    name: "Downtown Storefront",
    timezone: "America/Chicago",
  },
};

function fakeAuthProviderFor(identity: AuthIdentity | null): AuthProvider {
  return {
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
}

interface Fixture {
  connection: Connection;
  app: FastifyInstance;
}

async function setupFixture(identity: AuthIdentity | null = { userId: "auth-0", email: "owner@example.com", roles: [] }): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);
  const app = buildApp({ authProvider: fakeAuthProviderFor(identity), connection });
  return { connection, app };
}

describe("POST /merchants — merchant onboarding (D103)", () => {
  it("a new merchant completes setup unaided: creates the merchant, captures seller identity, assigns OWNER, and creates the first location", async () => {
    const { connection, app } = await setupFixture();

    const response = await app.inject({
      method: "POST",
      url: "/merchants",
      headers: { cookie: "session=valid-token" },
      payload: VALID_PAYLOAD,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { merchantId: string; slug: string; locationId: string };
    expect(body.merchantId).toBeTruthy();
    expect(body.locationId).toBeTruthy();

    const ctx = createTenantContext(body.merchantId);
    const merchant = new MerchantRepository(connection).findOwn(ctx);
    expect(merchant).toMatchObject({
      name: "Acme Rentals",
      legalName: "Acme Rentals LLC",
      taxId: "12-3456789",
      businessAddressLine1: "1 Main St",
      businessCity: "Springfield",
      businessPostalCode: "62701",
      businessCountry: "US",
    });

    const dbUser = new UserRepository(connection).findByEmail("owner@example.com");
    expect(dbUser).toBeTruthy();
    const role = new MerchantUserRepository(connection).findRole(ctx, dbUser!.id);
    expect(role).toBe("OWNER");
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = await setupFixture(null);

    const response = await app.inject({ method: "POST", url: "/merchants", payload: VALID_PAYLOAD });

    expect(response.statusCode).toBe(401);
  });

  it("rejects onboarding without a legal name or tax id — seller identity is required (DAC7/DSA readiness)", async () => {
    const { app } = await setupFixture();

    const response = await app.inject({
      method: "POST",
      url: "/merchants",
      headers: { cookie: "session=valid-token" },
      payload: { ...VALID_PAYLOAD, legalName: undefined, taxId: undefined },
    });

    expect(response.statusCode).toBe(400);
  });

  it("two different owners onboarding separately land in two distinct, mutually invisible merchants", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const appA = buildApp({
      authProvider: fakeAuthProviderFor({ userId: "auth-a", email: "a@example.com", roles: [] }),
      connection,
    });
    const appB = buildApp({
      authProvider: fakeAuthProviderFor({ userId: "auth-b", email: "b@example.com", roles: [] }),
      connection,
    });

    const resA = await appA.inject({
      method: "POST",
      url: "/merchants",
      headers: { cookie: "session=valid-token" },
      payload: { ...VALID_PAYLOAD, businessName: "Merchant A" },
    });
    const resB = await appB.inject({
      method: "POST",
      url: "/merchants",
      headers: { cookie: "session=valid-token" },
      payload: { ...VALID_PAYLOAD, businessName: "Merchant B" },
    });

    const bodyA = resA.json() as { merchantId: string };
    const bodyB = resB.json() as { merchantId: string };
    expect(bodyA.merchantId).not.toBe(bodyB.merchantId);

    const merchants = new MerchantRepository(connection);
    expect(merchants.findOwn(createTenantContext(bodyA.merchantId))?.name).toBe("Merchant A");
    expect(merchants.findOwn(createTenantContext(bodyB.merchantId))?.name).toBe("Merchant B");
  });
});
