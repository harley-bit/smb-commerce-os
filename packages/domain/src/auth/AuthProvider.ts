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
 * The identity a verified session resolves to, for use by authenticated
 * routes. Distinct from `TenantContext` (`packages/domain/src/tenancy`,
 * D017): this is *who* is calling (global user identity, no merchant
 * scope — a user can belong to several merchants via `merchant_users`),
 * while `TenantContext` is *which merchant's data* a repository call may
 * touch.
 */
export interface AuthIdentity {
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

/** Thrown by `exchangeAuthorizationCode` when the code is unknown, expired, or already redeemed. */
export class InvalidAuthorizationCodeError extends Error {
  constructor() {
    super("Invalid or expired authorization code.");
    this.name = "InvalidAuthorizationCodeError";
  }
}

/**
 * Thrown by `exchangeAuthorizationCode` when `SHA256(codeVerifier)` (base64url)
 * doesn't match the `codeChallenge` supplied when the code was issued —
 * RFC 7636's core PKCE check.
 */
export class PkceVerificationFailedError extends Error {
  constructor() {
    super("PKCE verification failed: code_verifier does not match the original code_challenge.");
    this.name = "PkceVerificationFailedError";
  }
}

/** Thrown by `refreshMobileSession` when the refresh token is unknown, expired, or revoked. */
export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Invalid, expired, or revoked refresh token.");
    this.name = "InvalidRefreshTokenError";
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
 * A short-lived, single-use authorization code (`docs/cards/D138.md`,
 * OAuth 2.0 Authorization Code + PKCE, RFC 7636) — redeemable exactly once
 * via `exchangeAuthorizationCode`, bound to the `codeChallenge` supplied
 * when it was issued.
 */
export interface AuthorizationCodeGrant {
  code: string;
  expiresAt: string;
}

/**
 * The token pair a mobile client stores in platform secure storage
 * (Keychain/Keystore — never `AsyncStorage`, per this card's security
 * check): a short-lived opaque access token (the same shape/semantics as
 * `Session.token`) plus a longer-lived opaque refresh token that redeems a
 * fresh pair via `refreshMobileSession`, rotating on every use.
 */
export interface MobileTokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
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
  verifySession(token: string): Promise<AuthIdentity | null>;
  revokeSession(token: string): Promise<void>;
  initiatePasswordReset(email: string): Promise<void>;
  completePasswordReset(token: string, newPassword: string): Promise<void>;
  /** Re-authenticates with the password, then issues a pending (unconfirmed) TOTP secret. */
  enrollMfa(email: string, password: string): Promise<MfaEnrollment>;
  /** Re-authenticates with the password and confirms the pending secret with a valid code. */
  confirmMfaEnrollment(email: string, password: string, code: string): Promise<void>;
  /**
   * Mobile PKCE authorization step (`docs/cards/D138.md`): mints a
   * short-lived, single-use code bound to `codeChallenge` for `userId`.
   * Only `codeChallengeMethod: "S256"` is supported — plain PKCE is not
   * offered.
   */
  createAuthorizationCode(
    userId: string,
    codeChallenge: string,
    codeChallengeMethod: "S256",
  ): Promise<AuthorizationCodeGrant>;
  /**
   * Mobile PKCE token exchange: redeems a code minted by
   * `createAuthorizationCode`, verifying `SHA256(codeVerifier)` (base64url)
   * matches the original `codeChallenge` before ever issuing tokens.
   * Throws `InvalidAuthorizationCodeError` for an unknown/expired/reused
   * code, `PkceVerificationFailedError` for a verifier mismatch.
   */
  exchangeAuthorizationCode(code: string, codeVerifier: string, ip: string, userAgent: string): Promise<MobileTokenPair>;
  /**
   * Redeems a refresh token for a fresh `MobileTokenPair`, rotating it
   * (the presented refresh token is revoked as part of issuing the new
   * one, so it can't be replayed). Throws `InvalidRefreshTokenError` for
   * an unknown/expired/already-revoked token.
   */
  refreshMobileSession(refreshToken: string, ip: string, userAgent: string): Promise<MobileTokenPair>;
  /** Mobile sign-out: revokes a refresh token so it can no longer mint new sessions. */
  revokeMobileSession(refreshToken: string): Promise<void>;
}
