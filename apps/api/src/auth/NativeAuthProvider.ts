import { randomBytes, createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { Secret, TOTP } from "otpauth";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidAuthorizationCodeError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  InvalidResetTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
  PkceVerificationFailedError,
  type AuthIdentity,
  type AuthorizationCodeGrant,
  type AuthProvider,
  type AuthResult,
  type MfaEnrollment,
  type MobileTokenPair,
  type Session,
} from "@smb-os/domain";
import { AccountBackoff } from "./rateLimiter.js";
import {
  InMemoryAuthorizationCodeRepository,
  InMemoryRefreshTokenRepository,
  type AuthorizationCodeRepository,
  type RefreshTokenRepository,
  type ResetTokenRepository,
  type SessionRepository,
  type UserRepository,
} from "./repositories.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes, per ADR-002
const AUTHORIZATION_CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes — RFC 7636 codes are meant to be redeemed immediately
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — mobile session lifetime (D138)
const MFA_ISSUER = "SMB Commerce OS";
/** Roles that ADR-002 / `docs/design/07` mandate TOTP MFA for. */
const MFA_REQUIRED_ROLES = new Set(["OWNER", "ADMIN"]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** RFC 7636 `S256`: `BASE64URL(SHA256(code_verifier))`. */
function pkceS256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function buildTotp(secretBase32: string, email: string): TOTP {
  return new TOTP({
    issuer: MFA_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

function verifyTotpCode(secretBase32: string, email: string, code: string): boolean {
  // window: 1 tolerates one 30s step of clock drift either side, standard practice for TOTP.
  return buildTotp(secretBase32, email).validate({ token: code, window: 1 }) !== null;
}

/**
 * Native (in-house) `AuthProvider` implementation — ADR-002. Only the
 * composition root (`apps/api/src/app.ts`) may import this class by name;
 * every other module depends on the `AuthProvider` interface from
 * `@smb-os/domain` instead, so a future `Auth0Provider` is a swap.
 */
export type ResetTokenNotifier = (email: string, rawToken: string) => void;

export class NativeAuthProvider implements AuthProvider {
  private readonly loginBackoff = new AccountBackoff();

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly resetTokens: ResetTokenRepository,
    // Real email delivery is out of scope for this card; defaults to a
    // no-op so the raw token is never persisted or logged anywhere.
    private readonly notifyResetToken: ResetTokenNotifier = () => undefined,
    // `docs/cards/D138.md` — mobile PKCE authorization codes and refresh
    // tokens. Optional constructor params (defaulting to fresh in-memory
    // repositories) so every existing `new NativeAuthProvider(...)` call
    // site that predates D138 keeps compiling unchanged.
    private readonly authorizationCodes: AuthorizationCodeRepository = new InMemoryAuthorizationCodeRepository(),
    private readonly refreshTokens: RefreshTokenRepository = new InMemoryRefreshTokenRepository(),
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }
    const passwordHash = await argon2Hash(password, { algorithm: Algorithm.Argon2id });
    const userId = randomUUID();
    await this.users.create({
      id: userId,
      email,
      passwordHash,
      roles: ["OWNER"],
      createdAt: new Date().toISOString(),
      mfaSecret: null,
      mfaEnabled: false,
    });
    return { userId, email };
  }

  async authenticate(email: string, password: string, mfaCode?: string): Promise<AuthResult> {
    const backoffKey = email.toLowerCase();
    if (this.loginBackoff.isLocked(backoffKey)) {
      throw new AccountLockedError();
    }

    const user = await this.users.findByEmail(email);
    if (!user) {
      // Constant-shape failure: don't leak whether the account exists.
      this.loginBackoff.recordFailure(backoffKey);
      throw new InvalidCredentialsError();
    }

    const valid = await argon2Verify(user.passwordHash, password);
    if (!valid) {
      this.loginBackoff.recordFailure(backoffKey);
      throw new InvalidCredentialsError();
    }

    if (user.roles.some((role) => MFA_REQUIRED_ROLES.has(role))) {
      if (!user.mfaEnabled) {
        // Password was correct; the account just isn't set up yet — not a login failure.
        this.loginBackoff.recordSuccess(backoffKey);
        throw new MfaEnrollmentRequiredError();
      }
      if (!mfaCode) {
        throw new MfaCodeRequiredError();
      }
      // user.mfaSecret is always set once mfaEnabled is true (only enableMfa() sets it).
      if (!verifyTotpCode(user.mfaSecret as string, user.email, mfaCode)) {
        this.loginBackoff.recordFailure(backoffKey);
        throw new InvalidMfaCodeError();
      }
    }

    this.loginBackoff.recordSuccess(backoffKey);
    return { userId: user.id, email: user.email };
  }

  async enrollMfa(email: string, password: string): Promise<MfaEnrollment> {
    const user = await this.reauthenticate(email, password);
    const secret = new Secret({ size: 20 }).base32;
    await this.users.setPendingMfaSecret(user.id, secret);
    return { secret, otpauthUrl: buildTotp(secret, user.email).toString() };
  }

  async confirmMfaEnrollment(email: string, password: string, code: string): Promise<void> {
    const user = await this.reauthenticate(email, password);
    if (!user.mfaSecret) {
      throw new MfaEnrollmentRequiredError();
    }
    if (!verifyTotpCode(user.mfaSecret, user.email, code)) {
      throw new InvalidMfaCodeError();
    }
    await this.users.enableMfa(user.id);
  }

  /** Password-only re-check used by the MFA enrollment endpoints, which run before any session exists. */
  private async reauthenticate(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await argon2Verify(user.passwordHash, password))) {
      throw new InvalidCredentialsError();
    }
    return user;
  }

  async createSession(userId: string, ip: string, userAgent: string): Promise<Session> {
    const token = randomBytes(32).toString("hex");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
    await this.sessions.create({
      token,
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      ip,
      userAgent,
    });
    return {
      token,
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verifySession(token: string): Promise<AuthIdentity | null> {
    const record = await this.sessions.findByToken(token);
    if (!record || record.revokedAt !== null) {
      return null;
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    const user = await this.users.findById(record.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, email: user.email, roles: user.roles };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sessions.revoke(token, new Date().toISOString());
  }

  async initiatePasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      // Same outward behavior whether or not the account exists.
      return;
    }
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + RESET_TOKEN_TTL_MS);
    await this.resetTokens.create({
      tokenHash,
      userId: user.id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
    });
    // The raw token is emailed exactly once here; only its hash is ever
    // persisted, so it can't be recovered from the store afterward.
    this.notifyResetToken(user.email, rawToken);
  }

  async completePasswordReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = sha256Hex(token);
    const record = await this.resetTokens.findByTokenHash(tokenHash);
    if (!record || record.usedAt !== null) {
      throw new InvalidResetTokenError();
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new InvalidResetTokenError();
    }
    const passwordHash = await argon2Hash(newPassword, { algorithm: Algorithm.Argon2id });
    await this.users.updatePasswordHash(record.userId, passwordHash);
    await this.resetTokens.markUsed(tokenHash, new Date().toISOString());
  }

  async createAuthorizationCode(
    userId: string,
    codeChallenge: string,
    codeChallengeMethod: "S256",
  ): Promise<AuthorizationCodeGrant> {
    const code = randomBytes(32).toString("hex");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + AUTHORIZATION_CODE_TTL_MS);
    await this.authorizationCodes.create({
      codeHash: sha256Hex(code),
      userId,
      codeChallenge,
      codeChallengeMethod,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    ip: string,
    userAgent: string,
  ): Promise<MobileTokenPair> {
    const record = await this.authorizationCodes.findByCodeHash(sha256Hex(code));
    if (!record || record.usedAt !== null || new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new InvalidAuthorizationCodeError();
    }
    // Single-use regardless of outcome: a wrong verifier still burns the code,
    // so a leaked code can't be brute-forced against multiple verifier guesses.
    await this.authorizationCodes.markUsed(record.codeHash, new Date().toISOString());
    if (!constantTimeEqual(pkceS256Challenge(codeVerifier), record.codeChallenge)) {
      throw new PkceVerificationFailedError();
    }
    return this.issueMobileTokenPair(record.userId, ip, userAgent);
  }

  async refreshMobileSession(refreshToken: string, ip: string, userAgent: string): Promise<MobileTokenPair> {
    const record = await this.refreshTokens.findByTokenHash(sha256Hex(refreshToken));
    if (!record || record.revokedAt !== null || new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new InvalidRefreshTokenError();
    }
    // Rotate: the presented refresh token is revoked immediately, so a
    // captured-and-replayed old token can never mint a second live pair.
    await this.refreshTokens.revoke(record.tokenHash, new Date().toISOString());
    return this.issueMobileTokenPair(record.userId, ip, userAgent);
  }

  async revokeMobileSession(refreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(sha256Hex(refreshToken), new Date().toISOString());
  }

  private async issueMobileTokenPair(userId: string, ip: string, userAgent: string): Promise<MobileTokenPair> {
    const session = await this.createSession(userId, ip, userAgent);
    const refreshToken = randomBytes(32).toString("hex");
    const createdAt = new Date();
    const refreshTokenExpiresAt = new Date(createdAt.getTime() + REFRESH_TOKEN_TTL_MS);
    await this.refreshTokens.create({
      tokenHash: sha256Hex(refreshToken),
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: refreshTokenExpiresAt.toISOString(),
      revokedAt: null,
      ip,
      userAgent,
    });
    return {
      accessToken: session.token,
      accessTokenExpiresAt: session.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }
}
