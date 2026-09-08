/**
 * In-memory, per-key sliding-window limiter for the login and
 * password-reset-request endpoints (ADR-002: rate-limited per-IP and
 * per-account from Phase 0). One process only — fine for the single-node
 * pilot this repo currently targets; a shared store (e.g. Redis) is a
 * later infra concern, not a reason to skip limiting now.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the request under `key` is allowed, recording it if so. */
  consume(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (existing.length >= this.limit) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}

/**
 * Progressive backoff after repeated failed logins on one account
 * (ADR-002 "account lockout / backoff"): each failure extends the
 * account's lockout window; a success clears it.
 */
export class AccountBackoff {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    // Failures below this count never lock the account — the first
    // couple of mistyped passwords shouldn't cost a delay. Backoff is
    // for "repeated" failures (ADR-002), not the first one.
    private readonly freeAttempts: number = 2,
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 60_000,
  ) {}

  isLocked(key: string, now: number = Date.now()): boolean {
    const entry = this.failures.get(key);
    return entry !== undefined && entry.lockedUntil > now;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    const count = entry.count + 1;
    const overage = count - this.freeAttempts;
    const lockedUntil =
      overage > 0 ? now + Math.min(this.baseDelayMs * 2 ** (overage - 1), this.maxDelayMs) : 0;
    this.failures.set(key, { count, lockedUntil });
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
