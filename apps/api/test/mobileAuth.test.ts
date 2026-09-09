import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Secret, TOTP } from "otpauth";
import { buildApp } from "../src/app";

const EMAIL = "mobile-owner@example.com";
const PASSWORD = "correct horse battery staple 42!";

function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function registerAndEnrollMfa(app: FastifyInstance): Promise<{ userId: string; totpSecret: string }> {
  const registerRes = await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
  const { userId } = registerRes.json() as { userId: string };

  const enrollRes = await app.inject({ method: "POST", url: "/auth/mfa/enroll", payload: { email: EMAIL, password: PASSWORD } });
  const { secret } = enrollRes.json() as { secret: string };
  const code = currentTotpCode(secret);
  await app.inject({ method: "POST", url: "/auth/mfa/confirm", payload: { email: EMAIL, password: PASSWORD, code } });

  return { userId, totpSecret: secret };
}

function currentTotpCode(secretBase32: string): string {
  return new TOTP({
    issuer: "SMB Commerce OS",
    label: EMAIL,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

describe("mobile auth routes (D138 — OIDC-style PKCE authorization code + refresh)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
    app.get("/__test-protected", { preHandler: app.authenticate }, async (request) => request.auth);
  });

  it("full sign-in: authorize -> token exchange -> access token authenticates a real protected route", async () => {
    const { userId, totpSecret } = await registerAndEnrollMfa(app);
    const { verifier, challenge } = newPkcePair();

    const authorizeRes = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentTotpCode(totpSecret), codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    expect(authorizeRes.statusCode).toBe(200);
    const { code } = authorizeRes.json() as { code: string };

    const tokenRes = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: { code, codeVerifier: verifier } });
    expect(tokenRes.statusCode).toBe(200);
    const pair = tokenRes.json() as { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string };
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    // Access token was never set as a cookie — mobile has no cookie jar.
    expect(tokenRes.headers["set-cookie"]).toBeUndefined();

    const protectedRes = await app.inject({
      method: "GET",
      url: "/__test-protected",
      headers: { authorization: `Bearer ${pair.accessToken}` },
    });
    // No `X-Merchant-Id` header was sent, so this correctly 400s rather
    // than 401 — proving the bearer token *did* resolve a real identity
    // before the middleware ever got to the merchant-header check.
    expect(protectedRes.statusCode).toBe(400);

    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${pair.accessToken}` } });
    expect(meRes.statusCode).toBe(200);
    expect((meRes.json() as { userId: string }).userId).toBe(userId);
  });

  it("refreshes to a new access token that also authenticates, rotating the old refresh token out", async () => {
    const { totpSecret } = await registerAndEnrollMfa(app);
    const { verifier, challenge } = newPkcePair();
    const authorizeRes = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentTotpCode(totpSecret), codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    const { code } = authorizeRes.json() as { code: string };
    const tokenRes = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: { code, codeVerifier: verifier } });
    const firstPair = tokenRes.json() as { accessToken: string; refreshToken: string };

    const refreshRes = await app.inject({ method: "POST", url: "/auth/mobile/refresh", payload: { refreshToken: firstPair.refreshToken } });
    expect(refreshRes.statusCode).toBe(200);
    const secondPair = refreshRes.json() as { accessToken: string; refreshToken: string };
    expect(secondPair.accessToken).not.toBe(firstPair.accessToken);
    expect(secondPair.refreshToken).not.toBe(firstPair.refreshToken);

    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${secondPair.accessToken}` } });
    expect(meRes.statusCode).toBe(200);

    // Old refresh token was rotated out — replaying it must fail.
    const replayRes = await app.inject({ method: "POST", url: "/auth/mobile/refresh", payload: { refreshToken: firstPair.refreshToken } });
    expect(replayRes.statusCode).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const { totpSecret } = await registerAndEnrollMfa(app);
    const { verifier, challenge } = newPkcePair();
    const authorizeRes = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentTotpCode(totpSecret), codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    const { code } = authorizeRes.json() as { code: string };
    const tokenRes = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: { code, codeVerifier: verifier } });
    const pair = tokenRes.json() as { refreshToken: string };

    const logoutRes = await app.inject({ method: "POST", url: "/auth/mobile/logout", payload: { refreshToken: pair.refreshToken } });
    expect(logoutRes.statusCode).toBe(204);

    const refreshRes = await app.inject({ method: "POST", url: "/auth/mobile/refresh", payload: { refreshToken: pair.refreshToken } });
    expect(refreshRes.statusCode).toBe(401);
  });

  it("rejects authorize with the wrong password", async () => {
    await registerAndEnrollMfa(app);
    const { challenge } = newPkcePair();
    const res = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: "wrong-password", codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects authorize with a missing MFA code for an MFA-enrolled account", async () => {
    await registerAndEnrollMfa(app);
    const { challenge } = newPkcePair();
    const res = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { mfaCodeRequired?: boolean }).mfaCodeRequired).toBe(true);
  });

  it("rejects authorize for an account that hasn't completed MFA enrollment yet", async () => {
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: "no-mfa@example.com", password: PASSWORD } });
    const { challenge } = newPkcePair();
    const res = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: "no-mfa@example.com", password: PASSWORD, codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { mfaEnrollmentRequired?: boolean }).mfaEnrollmentRequired).toBe(true);
  });

  it("rejects a codeChallengeMethod other than S256", async () => {
    await registerAndEnrollMfa(app);
    const res = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, codeChallenge: "whatever", codeChallengeMethod: "plain" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a token exchange with the wrong code_verifier", async () => {
    const { totpSecret } = await registerAndEnrollMfa(app);
    const { challenge } = newPkcePair();
    const authorizeRes = await app.inject({
      method: "POST",
      url: "/auth/mobile/authorize",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentTotpCode(totpSecret), codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    const { code } = authorizeRes.json() as { code: string };

    const res = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: { code, codeVerifier: "the-wrong-verifier" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a token exchange with an unknown code", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: { code: "not-a-real-code", codeVerifier: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a refresh with an unknown refresh token", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/refresh", payload: { refreshToken: "not-a-real-token" } });
    expect(res.statusCode).toBe(401);
  });

  it("400s /auth/mobile/authorize with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/authorize", payload: { email: EMAIL } });
    expect(res.statusCode).toBe(400);
  });

  it("400s /auth/mobile/token with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/token", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("400s /auth/mobile/refresh with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/refresh", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("logout with no refresh token is a harmless no-op, still 204", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/mobile/logout", payload: {} });
    expect(res.statusCode).toBe(204);
  });
});
