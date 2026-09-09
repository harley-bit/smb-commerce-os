import type { FastifyInstance } from "fastify";
import {
  AccountLockedError,
  InvalidAuthorizationCodeError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
  PkceVerificationFailedError,
  type AuthProvider,
} from "@smb-os/domain";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem, toProblemDetails } from "../problemDetails.js";

export interface MobileAuthRouteOptions {
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * `docs/cards/D138.md` — Mobile authentication: OAuth 2.0 Authorization
 * Code + PKCE (RFC 7636) issuing a Keychain/Keystore-stored access +
 * refresh token pair, layered on top of the same `AuthProvider.authenticate`
 * password/MFA logic `/auth/login` already uses (`docs/design/07`'s TOTP
 * requirement applies identically here — a mobile sign-in with no MFA
 * code for an OWNER/ADMIN account gets the same `MfaCodeRequiredError` a
 * web login would).
 *
 * There is no third-party OIDC identity provider or browser-redirect step
 * in this architecture (ADR-002 chose a native, in-house auth system, not
 * a delegated one) — these routes *are* the authorization server, called
 * directly by the app rather than via a system-browser redirect. PKCE's
 * usual threat model (a malicious app intercepting a redirect via a
 * shared custom URL scheme) doesn't apply to a direct API call the way it
 * does to a redirect-based flow; it's implemented here for literal
 * RFC 7636 compliance and defense-in-depth (a code that leaks through some
 * other channel — a proxy log, a crash report — still can't be redeemed
 * without the verifier that only this app instance ever held).
 */
export function registerMobileAuthRoutes(
  app: FastifyInstance,
  authProvider: AuthProvider,
  options: MobileAuthRouteOptions = {},
): void {
  const limiter = new SlidingWindowRateLimiter(options.rateLimit?.limit ?? 10, options.rateLimit?.windowMs ?? 60_000);

  app.post<{
    Body: {
      email?: string;
      password?: string;
      mfaCode?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    };
  }>("/auth/mobile/authorize", async (request, reply) => {
    const { email, password, mfaCode, codeChallenge, codeChallengeMethod } = request.body ?? {};
    if (!email || !password || !codeChallenge) {
      return sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        "email, password, and codeChallenge are required.",
      );
    }
    if (codeChallengeMethod !== "S256") {
      return sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        'codeChallengeMethod must be "S256".',
      );
    }

    const ip = request.ip;
    if (!limiter.consume(`ip:${ip}`) || !limiter.consume(`account:${email.toLowerCase()}`)) {
      return sendProblem(
        request,
        reply,
        429,
        problemType("rate-limited"),
        "Too Many Requests",
        "Too many authorization attempts. Try again later.",
      );
    }

    try {
      const result = await authProvider.authenticate(email, password, mfaCode);
      const grant = await authProvider.createAuthorizationCode(result.userId, codeChallenge, "S256");
      return reply.code(200).send(grant);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return sendProblem(request, reply, 401, problemType("unauthorized"), "Unauthorized", "Invalid email or password.");
      }
      if (error instanceof AccountLockedError) {
        return sendProblem(request, reply, 423, problemType("locked"), "Locked", error.message);
      }
      if (error instanceof MfaEnrollmentRequiredError) {
        return reply
          .code(409)
          .type("application/problem+json")
          .send({ ...toProblemDetails(request, 409, problemType("conflict"), "Conflict", error.message), mfaEnrollmentRequired: true });
      }
      if (error instanceof MfaCodeRequiredError) {
        return reply
          .code(401)
          .type("application/problem+json")
          .send({
            ...toProblemDetails(request, 401, problemType("unauthorized"), "Unauthorized", error.message),
            mfaCodeRequired: true,
          });
      }
      if (error instanceof InvalidMfaCodeError) {
        return sendProblem(request, reply, 401, problemType("unauthorized"), "Unauthorized", error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: { code?: string; codeVerifier?: string } }>("/auth/mobile/token", async (request, reply) => {
    const { code, codeVerifier } = request.body ?? {};
    if (!code || !codeVerifier) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "code and codeVerifier are required.");
    }
    try {
      const pair = await authProvider.exchangeAuthorizationCode(code, codeVerifier, request.ip, request.headers["user-agent"] ?? "unknown");
      return reply.code(200).send(pair);
    } catch (error) {
      if (error instanceof InvalidAuthorizationCodeError || error instanceof PkceVerificationFailedError) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/mobile/refresh", async (request, reply) => {
    const { refreshToken } = request.body ?? {};
    if (!refreshToken) {
      return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "refreshToken is required.");
    }
    try {
      const pair = await authProvider.refreshMobileSession(refreshToken, request.ip, request.headers["user-agent"] ?? "unknown");
      return reply.code(200).send(pair);
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        return sendProblem(request, reply, 401, problemType("unauthorized"), "Unauthorized", error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/mobile/logout", async (request, reply) => {
    const { refreshToken } = request.body ?? {};
    if (refreshToken) {
      await authProvider.revokeMobileSession(refreshToken);
    }
    return reply.code(204).send();
  });
}
