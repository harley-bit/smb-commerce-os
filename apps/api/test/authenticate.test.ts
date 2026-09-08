import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import { createConnection, runSqliteMigrations, MerchantRepository, MerchantUserRepository, UserRepository, type Connection } from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery staple 42!";

async function registerAndLogin(app: FastifyInstance): Promise<{ userId: string; sessionCookie: string }> {
  const registerRes = await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
  const { userId } = registerRes.json() as { userId: string };

  // OWNER accounts require MFA before login (ADR-002) — enroll and confirm first.
  const { Secret, TOTP } = await import("otpauth");
  const enrollRes = await app.inject({ method: "POST", url: "/auth/mfa/enroll", payload: { email: EMAIL, password: PASSWORD } });
  const { secret } = enrollRes.json() as { secret: string };
  const code = new TOTP({
    issuer: "SMB Commerce OS",
    label: EMAIL,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
  await app.inject({ method: "POST", url: "/auth/mfa/confirm", payload: { email: EMAIL, password: PASSWORD, code } });

  const loginRes = await app.inject({ method: "POST", url: "/auth/login", payload: { email: EMAIL, password: PASSWORD, mfaCode: code } });
  const setCookie = loginRes.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /session=([^;]+)/.exec(raw ?? "");
  if (!match) {
    throw new Error("expected a session cookie");
  }
  return { userId, sessionCookie: `session=${match[1]}` };
}

describe("authenticate middleware", () => {
  let connection: Connection;
  let merchantId: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const merchants = new MerchantRepository(connection);
    const ctx = createTenantContext(generateUuidV7());
    merchants.create(ctx, {
      name: "acme",
      slug: `acme-${generateUuidV7()}`,
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    merchantId = ctx.merchantId;

    app = buildApp({ merchantMembershipResolver: new DbMerchantMembershipResolver(connection) });
    app.get("/__test-protected", { preHandler: app.authenticate }, async (request) => {
      return request.auth;
    });
  });

  it("rejects a request with no session cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/__test-protected", headers: { "x-merchant-id": merchantId } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with an invalid/garbage session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test-protected",
      headers: { "x-merchant-id": merchantId, cookie: "session=not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request missing the X-Merchant-Id header", async () => {
    const { sessionCookie } = await registerAndLogin(app);
    const res = await app.inject({ method: "GET", url: "/__test-protected", headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a request with a malformed X-Merchant-Id header", async () => {
    const { sessionCookie } = await registerAndLogin(app);
    const res = await app.inject({
      method: "GET",
      url: "/__test-protected",
      headers: { cookie: sessionCookie, "x-merchant-id": "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a valid, authenticated user who is not a member of the requested merchant", async () => {
    const { sessionCookie } = await registerAndLogin(app);
    const res = await app.inject({
      method: "GET",
      url: "/__test-protected",
      headers: { cookie: sessionCookie, "x-merchant-id": merchantId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("populates request.auth with identity, tenant, and role for a valid member request", async () => {
    // `NativeAuthProvider`'s user ids (session subject) and `packages/db`'s
    // `users.id` (the FK `merchant_users.user_id` actually points at) are
    // not unified yet — no card has wired the API's auth layer to write
    // through `packages/db`'s `UserRepository` on registration. That's a
    // real, tracked gap (see this card's log), not something to silently
    // paper over here. This test proves the middleware's own contract
    // (verify session → resolve membership → populate `request.auth`)
    // using a real `packages/db` user id and a minimal fake `AuthProvider`
    // standing in for that not-yet-built link, rather than routing through
    // `/auth/register` and pretending the ids already match.
    const dbUsers = new UserRepository(connection);
    const userId = dbUsers.create({ email: EMAIL, status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" });
    const merchantUsers = new MerchantUserRepository(connection);
    merchantUsers.assignRole(createTenantContext(merchantId), "OWNER", userId, "OWNER", "2026-09-08T00:00:00.000Z");

    const identity: AuthIdentity = { userId, email: EMAIL, roles: ["OWNER"] };
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
    };
    const scopedApp = buildApp({
      authProvider: fakeAuthProvider,
      merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    });
    scopedApp.get("/__test-protected", { preHandler: scopedApp.authenticate }, async (request) => {
      return request.auth;
    });

    const res = await scopedApp.inject({
      method: "GET",
      url: "/__test-protected",
      headers: { cookie: "session=valid-token", "x-merchant-id": merchantId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { identity: { userId: string; email: string }; tenant: { merchantId: string }; role: string };
    expect(body.identity.userId).toBe(userId);
    expect(body.identity.email).toBe(EMAIL);
    expect(body.tenant.merchantId).toBe(merchantId);
    expect(body.role).toBe("OWNER");
  });
});
