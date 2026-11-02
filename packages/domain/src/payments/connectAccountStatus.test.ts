import { describe, expect, it } from "vitest";
import { deriveConnectAccountStatus } from "./connectAccountStatus.js";

describe("deriveConnectAccountStatus", () => {
  it("is ONBOARDING before the merchant submits details", () => {
    expect(
      deriveConnectAccountStatus({ detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false }),
    ).toBe("ONBOARDING");
  });

  it("is ACTIVE once details are submitted and charges/payouts are both enabled", () => {
    expect(
      deriveConnectAccountStatus({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }),
    ).toBe("ACTIVE");
  });

  it("is RESTRICTED when details are submitted but Stripe has not enabled charges yet", () => {
    expect(
      deriveConnectAccountStatus({ detailsSubmitted: true, chargesEnabled: false, payoutsEnabled: false }),
    ).toBe("RESTRICTED");
  });

  it("is RESTRICTED when charges are enabled but payouts are not", () => {
    expect(
      deriveConnectAccountStatus({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: false }),
    ).toBe("RESTRICTED");
  });
});
