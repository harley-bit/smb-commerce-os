import { describe, expect, it } from "vitest";
import {
  computeLateFeeProposal,
  confirmLateFee,
  InvalidLateFeePolicyError,
  type LateFeePolicy,
} from "./lateFeePolicy.js";

describe("computeLateFeeProposal", () => {
  const policy: LateFeePolicy = { perDayMinor: 1_000, graceHours: 24, capMinor: 5_000 };

  it("proposes zero when the overdue period has not exceeded the grace window", () => {
    const proposal = computeLateFeeProposal(policy, 24);
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.amountMinor).toBe(0);
  });

  it("charges one day's rate for any partial day past the grace window", () => {
    // 30 hours overdue, 24h grace -> 6 billable hours -> rounds up to 1 day
    const proposal = computeLateFeeProposal(policy, 30);
    expect(proposal.amountMinor).toBe(1_000);
  });

  it("charges per full billable day, rounding partial days up", () => {
    // 24h grace + 50 billable hours -> ceil(50/24) = 3 days
    const proposal = computeLateFeeProposal(policy, 74);
    expect(proposal.amountMinor).toBe(3_000);
  });

  it("never proposes above the policy's cap", () => {
    // 24h grace + 480 billable hours -> 20 days * 1000 = 20000, capped at 5000
    const proposal = computeLateFeeProposal(policy, 504);
    expect(proposal.amountMinor).toBe(5_000);
  });

  it("is uncapped when the policy has no capMinor", () => {
    const uncapped: LateFeePolicy = { perDayMinor: 1_000, graceHours: 0 };
    const proposal = computeLateFeeProposal(uncapped, 240);
    expect(proposal.amountMinor).toBe(10_000);
  });

  it("rejects a negative overdue duration", () => {
    expect(() => computeLateFeeProposal(policy, -1)).toThrow();
  });

  it("rejects an invalid policy (non-positive perDayMinor)", () => {
    expect(() =>
      computeLateFeeProposal({ perDayMinor: 0, graceHours: 0 }, 48),
    ).toThrow(InvalidLateFeePolicyError);
  });

  it("a proposal alone is never a charge — it only carries PROPOSED status", () => {
    const proposal = computeLateFeeProposal(policy, 100);
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal).not.toHaveProperty("confirmedByUserId");
  });
});

describe("confirmLateFee", () => {
  const policy: LateFeePolicy = { perDayMinor: 1_000, graceHours: 24 };

  it("requires an explicit merchant user id to move a proposal to APPLIED", () => {
    const proposal = computeLateFeeProposal(policy, 48);
    const applied = confirmLateFee(proposal, "user_merchant_1", "2026-09-08T00:00:00.000Z");
    expect(applied.status).toBe("APPLIED");
    expect(applied.confirmedByUserId).toBe("user_merchant_1");
    expect(applied.amountMinor).toBe(proposal.amountMinor);
  });

  it("refuses to confirm without a merchant user id", () => {
    const proposal = computeLateFeeProposal(policy, 48);
    expect(() => confirmLateFee(proposal, "", "2026-09-08T00:00:00.000Z")).toThrow();
  });

  it("refuses to confirm an already-applied fee (no double charge)", () => {
    const proposal = computeLateFeeProposal(policy, 48);
    const applied = confirmLateFee(proposal, "user_merchant_1", "2026-09-08T00:00:00.000Z");
    expect(() =>
      confirmLateFee(applied as never, "user_merchant_1", "2026-09-08T00:01:00.000Z"),
    ).toThrow();
  });
});
