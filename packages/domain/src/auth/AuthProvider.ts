/**
 * Result of a successful password authentication.
 */
export interface AuthResult {
  userId: string;
  email: string;
}

/**
 * A server-side session record. `token` is the opaque, high-entropy
 * value handed to the client (via an httpOnly cookie) — never a JWT,
 * per ADR-002, so it can be revoked server-side.
 */
export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * The identity a verified session resolves to, for use by
 * authenticated routes and (once tenants exist) row-level scoping.
 */
export interface TenantContext {
  userId: string;
  email: string;
  roles: string[];
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountLockedError extends Error {
  constructor() {
    super("Too many failed login attempts. Try again later.");
    this.name = "AccountLockedError";
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("Invalid or expired password reset token.");
    this.name = "InvalidResetTokenError";
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

/**
 * Authentication behind a provider seam (ADR-002): `apps/api` and every
 * other consumer must depend on this interface only. A native, in-house
 * implementation (`apps/api`) is Phase 0's provider; a future Auth0-backed
 * one swaps in without touching callers, provided nothing outside
 * `packages/domain/auth` ever imports a concrete provider class by name.
 */
export interface AuthProvider {
  register(email: string, password: string): Promise<AuthResult>;
  authenticate(email: string, password: string): Promise<AuthResult>;
  createSession(userId: string, ip: string, userAgent: string): Promise<Session>;
  verifySession(token: string): Promise<TenantContext | null>;
  revokeSession(token: string): Promise<void>;
  initiatePasswordReset(email: string): Promise<void>;
  completePasswordReset(token: string, newPassword: string): Promise<void>;
}
