import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { AuthProvider } from "@smb-os/domain";
import { AvailabilityCache, createConnection as createDbConnection, type Connection } from "@smb-os/db";
import { problemType, sendProblem } from "./problemDetails.js";
import { registerAvailabilityRoutes } from "./routes/availability.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerListingRoutes } from "./routes/listings.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidResetTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
} from "@smb-os/domain";
import { isAllowedOrigin } from "./auth/originCheck.js";
import { SlidingWindowRateLimiter } from "./auth/rateLimiter.js";
import {
  createDefaultMembershipResolver,
  registerAuthenticateDecorator,
  type MerchantMembershipResolver,
} from "./auth/authenticate.js";

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
  availabilityRateLimit?: { limit: number; windowMs: number };
  /** Injectable for tests that need to write a reservation and observe cache invalidation through the same cache the route reads. */
  availabilityCache?: AvailabilityCache;
  onResetTokenIssued?: ResetTokenNotifier;
  /** Test-only hook for asserting on structured log output; production uses stdout. */
  loggerStream?: Writable | { write: (chunk: string) => void };
  /** Injectable for tests; defaults to a real but unwired resolver — see `./auth/authenticate.ts`. */
  merchantMembershipResolver?: MerchantMembershipResolver;
  /**
   * `packages/db` connection backing tenant-scoped catalog routes (currently
   * just `./routes/listings.ts`). Defaults to a fresh in-memory SQLite
   * connection, migrated lazily on first route call — same honest gap as
   * `merchantMembershipResolver`'s default: unless a real, shared
   * connection is passed in, this default is disconnected from whatever
   * connection (if any) backs the membership resolver, so nothing will
   * actually resolve as a member in a from-scratch default `buildApp()`.
   * Real end-to-end DB wiring for `apps/api` is still a future card.
   */
  connection?: Connection;
  /**
   * `docs/cards/D091.md` — the Stripe webhook signing secret used to verify
   * `POST /webhooks/stripe`. Defaults to a placeholder in tests/dev; a real
   * deployment must supply the value from its Stripe Connect webhook
   * endpoint configuration, never a hardcoded default.
   */
  stripeWebhookSecret?: string;
}

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Fields that must never reach a log line, per this card's security
 * check ("no PII, tokens, or stack traces in logs or responses"):
 * credentials, session/reset tokens, and cookies (which carry the
 * session token).
 */
const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.newPassword",
  "req.body.token",
  "req.body.mfaCode",
  "req.body.code",
  "res.headers['set-cookie']",
];

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

  const app = Fastify({
    logger: {
      level: "info",
      redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: (request) => {
      const supplied = request.headers[REQUEST_ID_HEADER];
      return typeof supplied === "string" && supplied.length > 0 ? supplied : randomUUID();
    },
  });
  void app.register(cookie);

  // `docs/cards/D091.md` — capture the exact raw body alongside the parsed
  // JSON so `./routes/webhooks.ts` can verify Stripe's signature over the
  // real bytes received, not a re-serialized copy. Applies to every route
  // (harmless — `request.body` still parses normally); only the webhook
  // route reads `request.rawBody`.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body: string, done) => {
    request.rawBody = body;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  registerAuthenticateDecorator(
    app,
    authProvider,
    options.merchantMembershipResolver ?? createDefaultMembershipResolver(),
  );

  const connection = options.connection ?? createDbConnection(":memory:");
  const availabilityCache = options.availabilityCache ?? new AvailabilityCache();
  registerListingRoutes(app, connection);
  registerAvailabilityRoutes(app, connection, availabilityCache, {
    rateLimit: options.availabilityRateLimit,
  });
  registerBookingRoutes(app, connection, availabilityCache);
  registerWebhookRoutes(app, options.stripeWebhookSecret ?? "whsec_dev_placeholder");

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    return payload;
  });

  app.setNotFoundHandler((request, reply) => {
    sendProblem(
      request,
      reply,
      404,
      problemType("not-found"),
      "Not Found",
      `No route matches ${request.method} ${request.url}.`,
    );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    // Deliberately excludes error.message and error.stack from the log line: an
    // application error's message text is developer-written and not guaranteed
    // free of secrets, so only the stable, non-sensitive name/code are recorded.
    request.log.error({ err: { name: error.name, code: error.code } }, "request failed");
    if (status >= 500) {
      // Never surface an internal error message or stack trace to the client — this card's security check.
      sendProblem(request, reply, 500, problemType("internal-server-error"), "Internal Server Error");
      return;
    }
    sendProblem(request, reply, status, problemType("bad-request"), error.name || "Bad Request", error.message);
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/ready", async () => {
    return { status: "ready" };
  });

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

  app.post<{ Body: { email?: string; password?: string; mfaCode?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const { email, password, mfaCode } = request.body ?? {};
      if (!email || !password) {
        return reply.code(400).send({ error: "email and password are required." });
      }

      const ip = request.ip;
      if (!loginLimiter.consume(`ip:${ip}`) || !loginLimiter.consume(`account:${email.toLowerCase()}`)) {
        return reply.code(429).send({ error: "Too many login attempts. Try again later." });
      }

      try {
        const result = await authProvider.authenticate(email, password, mfaCode);
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
        if (error instanceof MfaEnrollmentRequiredError) {
          return reply.code(409).send({ error: error.message, mfaEnrollmentRequired: true });
        }
        if (error instanceof MfaCodeRequiredError) {
          return reply.code(401).send({ error: error.message, mfaCodeRequired: true });
        }
        if (error instanceof InvalidMfaCodeError) {
          return reply.code(401).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>("/auth/mfa/enroll", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required." });
    }
    const ip = request.ip;
    if (!loginLimiter.consume(`ip:${ip}`) || !loginLimiter.consume(`account:${email.toLowerCase()}`)) {
      return reply.code(429).send({ error: "Too many attempts. Try again later." });
    }
    try {
      const enrollment = await authProvider.enrollMfa(email, password);
      return reply.code(200).send(enrollment);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.code(401).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post<{ Body: { email?: string; password?: string; code?: string } }>(
    "/auth/mfa/confirm",
    async (request, reply) => {
      const { email, password, code } = request.body ?? {};
      if (!email || !password || !code) {
        return reply.code(400).send({ error: "email, password, and code are required." });
      }
      const ip = request.ip;
      if (!loginLimiter.consume(`ip:${ip}`) || !loginLimiter.consume(`account:${email.toLowerCase()}`)) {
        return reply.code(429).send({ error: "Too many attempts. Try again later." });
      }
      try {
        await authProvider.confirmMfaEnrollment(email, password, code);
        return reply.code(200).send({ message: "Multi-factor authentication enabled." });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return reply.code(401).send({ error: error.message });
        }
        if (error instanceof MfaEnrollmentRequiredError || error instanceof InvalidMfaCodeError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

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
