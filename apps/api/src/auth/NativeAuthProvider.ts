import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { Secret, TOTP } from "otpauth";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidResetTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
  type AuthProvider,
  type AuthResult,
  type MfaEnrollment,
  type Session,
  type TenantContext,
} from "@smb-os/domain";
import { AccountBackoff } from "./rateLimiter.js";
import type { ResetTokenRepository, SessionRepository, UserRepository } from "./repositories.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes, per ADR-002
const MFA_ISSUER = "SMB Commerce OS";
/** Roles that ADR-002 / `docs/design/07` mandate TOTP MFA for. */
const MFA_REQUIRED_ROLES = new Set(["OWNER", "ADMIN"]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

  async verifySession(token: string): Promise<TenantContext | null> {
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
}
