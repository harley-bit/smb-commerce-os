import { describe, expect, it } from "vitest";
import { evaluateMediaRetention } from "./mediaRetentionPolicy.js";

describe("evaluateMediaRetention (D085)", () => {
  it("is not eligible before 90 days when no claim was ever filed", () => {
    const decision = evaluateMediaRetention(
      { rentalCompletedAt: "2026-01-01T00:00:00.000Z", claimStatus: { kind: "NONE" } },
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: false });
  });

  it("is eligible exactly at 90 days when no claim was ever filed", () => {
    const decision = evaluateMediaRetention(
      { rentalCompletedAt: "2026-01-01T00:00:00.000Z", claimStatus: { kind: "NONE" } },
      new Date("2026-04-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: true, reason: "NO_CLAIM_90_DAYS" });
  });

  it("is eligible well past 90 days when no claim was ever filed", () => {
    const decision = evaluateMediaRetention(
      { rentalCompletedAt: "2026-01-01T00:00:00.000Z", claimStatus: { kind: "NONE" } },
      new Date("2026-12-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: true, reason: "NO_CLAIM_90_DAYS" });
  });

  it("is never eligible while a claim is live (filed, not yet resolved), regardless of elapsed time", () => {
    const decision = evaluateMediaRetention(
      { rentalCompletedAt: "2020-01-01T00:00:00.000Z", claimStatus: { kind: "LIVE" } },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: false });
  });

  it("is never eligible while a claim is disputed, regardless of elapsed time", () => {
    const decision = evaluateMediaRetention(
      { rentalCompletedAt: "2020-01-01T00:00:00.000Z", claimStatus: { kind: "DISPUTED" } },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: false });
  });

  it("is not eligible before 2 years after a claim's resolution", () => {
    const decision = evaluateMediaRetention(
      {
        rentalCompletedAt: "2020-01-01T00:00:00.000Z",
        claimStatus: { kind: "RESOLVED", resolvedAt: "2026-01-01T00:00:00.000Z" },
      },
      new Date("2027-06-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: false });
  });

  it("is eligible exactly 2 years after a claim's resolution", () => {
    const decision = evaluateMediaRetention(
      {
        rentalCompletedAt: "2020-01-01T00:00:00.000Z",
        claimStatus: { kind: "RESOLVED", resolvedAt: "2026-01-01T00:00:00.000Z" },
      },
      new Date("2028-01-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: true, reason: "CLAIM_RESOLVED_2_YEARS" });
  });

  it("keys the resolved-claim clock off resolution, not rental completion", () => {
    // Rental completed long ago, but the claim only just resolved — 90-day
    // no-claim retention must not apply once a claim has ever been filed.
    const decision = evaluateMediaRetention(
      {
        rentalCompletedAt: "2020-01-01T00:00:00.000Z",
        claimStatus: { kind: "RESOLVED", resolvedAt: "2026-06-01T00:00:00.000Z" },
      },
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(decision).toEqual({ eligible: false });
  });
});
