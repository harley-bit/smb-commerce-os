import { describe, expect, it } from "vitest";
import { AccountBackoff, SlidingWindowRateLimiter } from "../src/auth/rateLimiter";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit within the window, then rejects", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    const now = 1_000_000;
    expect(limiter.consume("k", now)).toBe(true);
    expect(limiter.consume("k", now)).toBe(true);
    expect(limiter.consume("k", now)).toBe(false);
  });

  it("resets once the window has passed", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.consume("k", now)).toBe(true);
    expect(limiter.consume("k", now + 500)).toBe(false);
    expect(limiter.consume("k", now + 1001)).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("b", now)).toBe(true);
  });
});

describe("AccountBackoff", () => {
  it("does not lock out the first free attempts, then locks and clears on success", () => {
    const backoff = new AccountBackoff(0, 1000, 60_000);
    const now = 1_000_000;
    expect(backoff.isLocked("acct", now)).toBe(false);
    backoff.recordFailure("acct", now);
    expect(backoff.isLocked("acct", now)).toBe(true);
    expect(backoff.isLocked("acct", now + 1001)).toBe(false);

    backoff.recordFailure("acct", now);
    backoff.recordSuccess("acct");
    expect(backoff.isLocked("acct", now)).toBe(false);
  });

  it("does not lock out failures within the free-attempt allowance", () => {
    const backoff = new AccountBackoff(2, 1000, 60_000);
    const now = 1_000_000;
    backoff.recordFailure("acct", now);
    backoff.recordFailure("acct", now);
    expect(backoff.isLocked("acct", now)).toBe(false);
  });

  it("increases delay progressively with repeated failures past the free allowance", () => {
    const backoff = new AccountBackoff(0, 1000, 60_000);
    const now = 1_000_000;
    backoff.recordFailure("acct", now);
    backoff.recordFailure("acct", now);
    // Second failure's delay (2000ms) should still lock at now + 1500.
    expect(backoff.isLocked("acct", now + 1500)).toBe(true);
  });

  it("caps the delay at maxDelayMs", () => {
    const backoff = new AccountBackoff(0, 1000, 5000);
    const now = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      backoff.recordFailure("acct", now);
    }
    expect(backoff.isLocked("acct", now + 5001)).toBe(false);
  });
});
