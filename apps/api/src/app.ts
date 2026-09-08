import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { AuthProvider } from "@smb-os/domain";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidResetTokenError,
} from "@smb-os/domain";
import { isAllowedOrigin } from "./auth/originCheck.js";
import { SlidingWindowRateLimiter } from "./auth/rateLimiter.js";

// This is the one file in `apps/api` allowed to name `NativeAuthProvider`
// (it wires the concrete class to a real `AuthProvider` binding below);
// every route handler in this file depends only on the `AuthProvider`
// interface from `@smb-os/domain`.
import { NativeAuthProvider, type ResetTokenNotifier } from "./auth/NativeAuthProvider.js";
import {
  InMemoryResetTokenRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "./auth/repositories.js";

const SESSION_COOKIE = "session";

export interface BuildAppOptions {
  authProvider?: AuthProvider;
  allowedOrigins?: readonly string[];
  loginRateLimit?: { limit: number; windowMs: number };
  resetRateLimit?: { limit: number; windowMs: number };
  onResetTokenIssued?: ResetTokenNotifier;
}

/** Default, in-memory-backed native provider — see `./auth/repositories.ts`. */
export function createDefaultAuthProvider(onResetTokenIssued?: ResetTokenNotifier): AuthProvider {
  return new NativeAuthProvider(
    new InMemoryUserRepository(),
    new InMemorySessionRepository(),
    new InMemoryResetTokenRepository(),
    onResetTokenIssued,
  );
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const authProvider = options.authProvider ?? createDefaultAuthProvider(options.onResetTokenIssued);
  const allowedOrigins = options.allowedOrigins ?? [];
  const loginLimiter = new SlidingWindowRateLimiter(
    options.loginRateLimit?.limit ?? 10,
    options.loginRateLimit?.windowMs ?? 60_000,
  );
  const resetLimiter = new SlidingWindowRateLimiter(
    options.resetRateLimit?.limit ?? 5,
    options.resetRateLimit?.windowMs ?? 60_000,
  );

  const app = Fastify({ logger: false });
  void app.register(cookie);

  app.addHook("preHandler", async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return;
    }
    if (allowedOrigins.length === 0) {
      return;
    }
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    if (!isAllowedOrigin(origin, referer, allowedOrigins)) {
      await reply.code(403).send({ error: "Cross-origin request rejected." });
    }
  });

  app.post<{ Body: { email?: string; password?: string } }>("/auth/register", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required." });
    }
    try {
      const result = await authProvider.register(email, password);
      return reply.code(201).send({ userId: result.userId, email: result.email });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post<{ Body: { email?: string; password?: string } }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required." });
    }

    const ip = request.ip;
    if (!loginLimiter.consume(`ip:${ip}`) || !loginLimiter.consume(`account:${email.toLowerCase()}`)) {
      return reply.code(429).send({ error: "Too many login attempts. Try again later." });
    }

    try {
      const result = await authProvider.authenticate(email, password);
      const session = await authProvider.createSession(
        result.userId,
        ip,
        request.headers["user-agent"] ?? "unknown",
      );
      void reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        expires: new Date(session.expiresAt),
      });
      return reply.code(200).send({ userId: result.userId, email: result.email });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.code(401).send({ error: "Invalid email or password." });
      }
      if (error instanceof AccountLockedError) {
        return reply.code(423).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await authProvider.revokeSession(token);
    }
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const context = token ? await authProvider.verifySession(token) : null;
    if (!context) {
      return reply.code(401).send({ error: "Not authenticated." });
    }
    return reply.code(200).send({ userId: context.userId, email: context.email, roles: context.roles });
  });

  app.post<{ Body: { email?: string } }>("/auth/password-reset/initiate", async (request, reply) => {
    const { email } = request.body ?? {};
    if (!email) {
      return reply.code(400).send({ error: "email is required." });
    }
    const ip = request.ip;
    if (!resetLimiter.consume(`ip:${ip}`) || !resetLimiter.consume(`account:${email.toLowerCase()}`)) {
      return reply.code(429).send({ error: "Too many reset requests. Try again later." });
    }
    await authProvider.initiatePasswordReset(email);
    // Always the same response, whether or not the account exists.
    return reply.code(202).send({ message: "If that account exists, a reset link has been sent." });
  });

  app.post<{ Body: { token?: string; newPassword?: string } }>(
    "/auth/password-reset/complete",
    async (request, reply) => {
      const { token, newPassword } = request.body ?? {};
      if (!token || !newPassword) {
        return reply.code(400).send({ error: "token and newPassword are required." });
      }
      try {
        await authProvider.completePasswordReset(token, newPassword);
        return reply.code(200).send({ message: "Password updated." });
      } catch (error) {
        if (error instanceof InvalidResetTokenError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  return app;
}
