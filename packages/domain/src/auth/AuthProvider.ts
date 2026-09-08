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
 * Thrown by `authenticate` when the account's role requires MFA (ADR-002:
 * `OWNER`/`ADMIN`) but no TOTP secret has been enrolled yet. The caller
 * must complete `enrollMfa` + `confirmMfaEnrollment` before logging in.
 */
export class MfaEnrollmentRequiredError extends Error {
  constructor() {
    super("Multi-factor authentication must be set up for this account before logging in.");
    this.name = "MfaEnrollmentRequiredError";
  }
}

/** Thrown by `authenticate` when MFA is enrolled but no code was supplied. */
export class MfaCodeRequiredError extends Error {
  constructor() {
    super("A multi-factor authentication code is required.");
    this.name = "MfaCodeRequiredError";
  }
}

/** Thrown by `authenticate` or `confirmMfaEnrollment` when the TOTP code is wrong or expired. */
export class InvalidMfaCodeError extends Error {
  constructor() {
    super("Invalid or expired multi-factor authentication code.");
    this.name = "InvalidMfaCodeError";
  }
}

/** A freshly generated, not-yet-confirmed TOTP enrollment (ADR-002 / `docs/design/07`). */
export interface MfaEnrollment {
  /** Base32 TOTP secret — shown once for manual entry. */
  secret: string;
  /** `otpauth://` URI suitable for rendering as a QR code. */
  otpauthUrl: string;
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
  /**
   * `mfaCode` is required once the account has completed MFA enrollment
   * (mandatory for `OWNER`/`ADMIN` per ADR-002); throws
   * `MfaEnrollmentRequiredError` / `MfaCodeRequiredError` / `InvalidMfaCodeError`
   * as appropriate instead of accepting a partially-authenticated login.
   */
  authenticate(email: string, password: string, mfaCode?: string): Promise<AuthResult>;
  createSession(userId: string, ip: string, userAgent: string): Promise<Session>;
  verifySession(token: string): Promise<TenantContext | null>;
  revokeSession(token: string): Promise<void>;
  initiatePasswordReset(email: string): Promise<void>;
  completePasswordReset(token: string, newPassword: string): Promise<void>;
  /** Re-authenticates with the password, then issues a pending (unconfirmed) TOTP secret. */
  enrollMfa(email: string, password: string): Promise<MfaEnrollment>;
  /** Re-authenticates with the password and confirms the pending secret with a valid code. */
  confirmMfaEnrollment(email: string, password: string, code: string): Promise<void>;
}
