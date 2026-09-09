import { describe, expect, it } from "vitest";
import { computeHoldCountdown } from "./holdCountdown.js";

describe("computeHoldCountdown", () => {
  it("reports the milliseconds remaining until expiresAt when the hold is still active (D127)", () => {
    const result = computeHoldCountdown("2026-10-01T09:15:00.000Z", new Date("2026-10-01T09:10:00.000Z"));
    expect(result).toEqual({ msRemaining: 5 * 60_000, expired: false });
  });

  it("reports zero remaining and expired: true the instant expiresAt is reached (D127)", () => {
    const result = computeHoldCountdown("2026-10-01T09:15:00.000Z", new Date("2026-10-01T09:15:00.000Z"));
    expect(result).toEqual({ msRemaining: 0, expired: true });
  });

  it("never reports negative msRemaining once expiresAt has passed (D127)", () => {
    const result = computeHoldCountdown("2026-10-01T09:15:00.000Z", new Date("2026-10-01T09:20:00.000Z"));
    expect(result).toEqual({ msRemaining: 0, expired: true });
  });
});
