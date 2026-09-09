/**
 * In-memory persistence for D010.
 *
 * `packages/db` gets real Drizzle/SQLite/Postgres wiring in D013–D015
 * (Phase 1, after this card) — see `docs/BUILD_CALENDAR.md`. Until then,
 * the native auth provider is built against these repository interfaces
 * so swapping in Drizzle-backed implementations later only touches this
 * file, not the provider or routes.
 */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
  createdAt: string;
  /** Pending or confirmed TOTP secret (base32). Null until `enrollMfa` is called. */
  mfaSecret: string | null;
  /** True once `confirmMfaEnrollment` has verified a code against `mfaSecret`. */
  mfaEnabled: boolean;
}

export interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string;
  userAgent: string;
}

export interface ResetTokenRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** Mobile PKCE authorization code (`docs/cards/D138.md`) — stored by `SHA256(code)`, never the raw code. */
export interface AuthorizationCodeRecord {
  codeHash: string;
  userId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** Mobile refresh token (`docs/cards/D138.md`) — stored by `SHA256(token)`, never the raw token. */
export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string;
  userAgent: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(record: UserRecord): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  setPendingMfaSecret(userId: string, secret: string): Promise<void>;
  enableMfa(userId: string): Promise<void>;
}

export interface SessionRepository {
  create(record: SessionRecord): Promise<void>;
  findByToken(token: string): Promise<SessionRecord | null>;
  revoke(token: string, revokedAt: string): Promise<void>;
}

export interface ResetTokenRepository {
  create(record: ResetTokenRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<ResetTokenRecord | null>;
  markUsed(tokenHash: string, usedAt: string): Promise<void>;
}

export interface AuthorizationCodeRepository {
  create(record: AuthorizationCodeRecord): Promise<void>;
  findByCodeHash(codeHash: string): Promise<AuthorizationCodeRecord | null>;
  markUsed(codeHash: string, usedAt: string): Promise<void>;
}

export interface RefreshTokenRepository {
  create(record: RefreshTokenRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(tokenHash: string, revokedAt: string): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async create(record: UserRecord): Promise<void> {
    this.byId.set(record.id, record);
    this.byEmail.set(record.email.toLowerCase(), record.id);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const existing = this.byId.get(userId);
    if (!existing) {
      return;
    }
    this.byId.set(userId, { ...existing, passwordHash });
  }

  async setPendingMfaSecret(userId: string, secret: string): Promise<void> {
    const existing = this.byId.get(userId);
    if (!existing) {
      return;
    }
    this.byId.set(userId, { ...existing, mfaSecret: secret, mfaEnabled: false });
  }

  async enableMfa(userId: string): Promise<void> {
    const existing = this.byId.get(userId);
    if (!existing) {
      return;
    }
    this.byId.set(userId, { ...existing, mfaEnabled: true });
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly byToken = new Map<string, SessionRecord>();

  async create(record: SessionRecord): Promise<void> {
    this.byToken.set(record.token, record);
  }

  async findByToken(token: string): Promise<SessionRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async revoke(token: string, revokedAt: string): Promise<void> {
    const existing = this.byToken.get(token);
    if (!existing) {
      return;
    }
    this.byToken.set(token, { ...existing, revokedAt });
  }
}

export class InMemoryResetTokenRepository implements ResetTokenRepository {
  private readonly byHash = new Map<string, ResetTokenRecord>();

  async create(record: ResetTokenRecord): Promise<void> {
    this.byHash.set(record.tokenHash, record);
  }

  async findByTokenHash(tokenHash: string): Promise<ResetTokenRecord | null> {
    return this.byHash.get(tokenHash) ?? null;
  }

  async markUsed(tokenHash: string, usedAt: string): Promise<void> {
    const existing = this.byHash.get(tokenHash);
    if (!existing) {
      return;
    }
    this.byHash.set(tokenHash, { ...existing, usedAt });
  }
}

export class InMemoryAuthorizationCodeRepository implements AuthorizationCodeRepository {
  private readonly byHash = new Map<string, AuthorizationCodeRecord>();

  async create(record: AuthorizationCodeRecord): Promise<void> {
    this.byHash.set(record.codeHash, record);
  }

  async findByCodeHash(codeHash: string): Promise<AuthorizationCodeRecord | null> {
    return this.byHash.get(codeHash) ?? null;
  }

  async markUsed(codeHash: string, usedAt: string): Promise<void> {
    const existing = this.byHash.get(codeHash);
    if (!existing) {
      return;
    }
    this.byHash.set(codeHash, { ...existing, usedAt });
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byHash = new Map<string, RefreshTokenRecord>();

  async create(record: RefreshTokenRecord): Promise<void> {
    this.byHash.set(record.tokenHash, record);
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.byHash.get(tokenHash) ?? null;
  }

  async revoke(tokenHash: string, revokedAt: string): Promise<void> {
    const existing = this.byHash.get(tokenHash);
    if (!existing) {
      return;
    }
    this.byHash.set(tokenHash, { ...existing, revokedAt });
  }
}
