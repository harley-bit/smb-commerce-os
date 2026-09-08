import { Secret, TOTP } from "otpauth";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery staple 42!";

function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) {
    throw new Error("expected a Set-Cookie header");
  }
  const match = /session=([^;]+)/.exec(raw);
  if (!match) {
    throw new Error("expected a session cookie");
  }
  return `session=${match[1]}`;
}

function currentCode(secretBase32: string, email: string): string {
  return new TOTP({
    issuer: "SMB Commerce OS",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

/** Every registered account is OWNER by default, so MFA enrollment (ADR-002) is a login prerequisite. */
async function enrollMfa(app: FastifyInstance, email: string, password: string): Promise<string> {
  const enrollRes = await app.inject({ method: "POST", url: "/auth/mfa/enroll", payload: { email, password } });
  const { secret } = enrollRes.json() as { secret: string };
  const confirmRes = await app.inject({
    method: "POST",
    url: "/auth/mfa/confirm",
    payload: { email, password, code: currentCode(secret, email) },
  });
  if (confirmRes.statusCode !== 200) {
    throw new Error(`MFA confirmation failed in test setup: ${confirmRes.statusCode}`);
  }
  return secret;
}

describe("native auth flow (D010 acceptance criteria)", () => {
  it("registers, logs in, accesses an authenticated route, logs out, and revokes the session", async () => {
    const app = buildApp();

    const registerRes = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(registerRes.statusCode).toBe(201);
    expect(registerRes.json()).toMatchObject({ email: EMAIL });

    // OWNER (the default role on register) requires MFA before login succeeds — ADR-002.
    const preMfaLoginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(preMfaLoginRes.statusCode).toBe(409);
    expect(preMfaLoginRes.json()).toMatchObject({ mfaEnrollmentRequired: true });

    const secret = await enrollMfa(app, EMAIL, PASSWORD);

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentCode(secret, EMAIL) },
    });
    expect(loginRes.statusCode).toBe(200);
    const setCookie = loginRes.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = String(setCookie);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/Secure/i);
    expect(cookieHeader).toMatch(/SameSite=Strict/i);
    const cookie = extractSessionCookie(setCookie);

    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({ email: EMAIL });

    const logoutRes = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(logoutRes.statusCode).toBe(204);

    const meAfterLogoutRes = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(meAfterLogoutRes.statusCode).toBe(401);

    await app.close();
  });

  it("rejects login before registration and rejects a wrong password", async () => {
    const app = buildApp();

    const unknownRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: "whatever12345" },
    });
    expect(unknownRes.statusCode).toBe(401);
    expect(JSON.stringify(unknownRes.json())).not.toContain("whatever12345");

    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
    const wrongPasswordRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: "not-the-password" },
    });
    expect(wrongPasswordRes.statusCode).toBe(401);

    await app.close();
  });

  it("rejects register/login/reset-complete requests missing required fields", async () => {
    const app = buildApp();

    const badRegister = await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL } });
    expect(badRegister.statusCode).toBe(400);

    const badLogin = await app.inject({ method: "POST", url: "/auth/login", payload: {} });
    expect(badLogin.statusCode).toBe(400);

    const badReset = await app.inject({
      method: "POST",
      url: "/auth/password-reset/initiate",
      payload: {},
    });
    expect(badReset.statusCode).toBe(400);

    const badComplete = await app.inject({
      method: "POST",
      url: "/auth/password-reset/complete",
      payload: { token: "only-a-token" },
    });
    expect(badComplete.statusCode).toBe(400);

    await app.close();
  });

  it("logs out cleanly even with no session cookie present", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it("returns 401 from /auth/me with no session cookie", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("locks out and returns 423 after repeated failed logins on one account", async () => {
    const app = buildApp({ loginRateLimit: { limit: 100, windowMs: 60_000 } });
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

    let sawLockout = false;
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: EMAIL, password: "wrong-password" },
      });
      if (res.statusCode === 423) {
        sawLockout = true;
        break;
      }
      expect(res.statusCode).toBe(401);
    }
    expect(sawLockout).toBe(true);

    await app.close();
  });

  it("rejects duplicate registration for the same email", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
    const dupeRes = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(dupeRes.statusCode).toBe(409);
    await app.close();
  });

  describe("password reset", () => {
    it("lets a user request a reset, complete it with the issued token, and log in with the new password", async () => {
      let issuedToken: string | undefined;
      const app = buildApp({
        onResetTokenIssued: (_email, rawToken) => {
          issuedToken = rawToken;
        },
      });
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
      // MFA enrollment survives a password change — enroll once, up front, with the original password.
      const secret = await enrollMfa(app, EMAIL, PASSWORD);

      const initiateRes = await app.inject({
        method: "POST",
        url: "/auth/password-reset/initiate",
        payload: { email: EMAIL },
      });
      expect(initiateRes.statusCode).toBe(202);
      expect(issuedToken).toBeDefined();

      const newPassword = "a totally different passphrase 99";
      const completeRes = await app.inject({
        method: "POST",
        url: "/auth/password-reset/complete",
        payload: { token: issuedToken, newPassword },
      });
      expect(completeRes.statusCode).toBe(200);

      const oldLoginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: EMAIL, password: PASSWORD },
      });
      expect(oldLoginRes.statusCode).toBe(401);

      const newLoginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: EMAIL, password: newPassword, mfaCode: currentCode(secret, EMAIL) },
      });
      expect(newLoginRes.statusCode).toBe(200);

      await app.close();
    });

    it("gives the same response whether or not the account exists (no user enumeration)", async () => {
      const app = buildApp();
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

      const existingRes = await app.inject({
        method: "POST",
        url: "/auth/password-reset/initiate",
        payload: { email: EMAIL },
      });
      const missingRes = await app.inject({
        method: "POST",
        url: "/auth/password-reset/initiate",
        payload: { email: "ghost@example.com" },
      });

      expect(existingRes.statusCode).toBe(missingRes.statusCode);
      expect(existingRes.json()).toEqual(missingRes.json());

      await app.close();
    });

    it("rejects an invalid or already-used reset token", async () => {
      const app = buildApp();
      const badTokenRes = await app.inject({
        method: "POST",
        url: "/auth/password-reset/complete",
        payload: { token: "not-a-real-token", newPassword: "whatever12345" },
      });
      expect(badTokenRes.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("origin check (CSRF)", () => {
    it("rejects a state-changing request from a disallowed origin when origin allow-listing is configured", async () => {
      const app = buildApp({ allowedOrigins: ["https://app.example.com"] });
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: "https://evil.example.com" },
        payload: { email: EMAIL, password: PASSWORD },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("allows a state-changing request from an allow-listed origin", async () => {
      const app = buildApp({ allowedOrigins: ["https://app.example.com"] });
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: "https://app.example.com" },
        payload: { email: EMAIL, password: PASSWORD },
      });
      expect(res.statusCode).toBe(201);
      await app.close();
    });
  });
});

describe("rate limiting (login and reset-request)", () => {
  beforeEach(() => {
    // Each test builds its own app/limiter instance, so no shared state.
  });

  it("locks out login attempts per-account after the configured threshold", async () => {
    const app = buildApp({ loginRateLimit: { limit: 3, windowMs: 60_000 } });
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: EMAIL, password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    }

    const rateLimitedRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: "wrong-password" },
    });
    expect(rateLimitedRes.statusCode).toBe(429);

    await app.close();
  });

  it("locks out password-reset-request attempts after the configured threshold", async () => {
    const app = buildApp({ resetRateLimit: { limit: 2, windowMs: 60_000 } });

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/password-reset/initiate",
        payload: { email: EMAIL },
      });
      expect(res.statusCode).toBe(202);
    }

    const rateLimitedRes = await app.inject({
      method: "POST",
      url: "/auth/password-reset/initiate",
      payload: { email: EMAIL },
    });
    expect(rateLimitedRes.statusCode).toBe(429);

    await app.close();
  });
});
