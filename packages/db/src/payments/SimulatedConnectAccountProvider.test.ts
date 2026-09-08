import { describe, expect, it } from "vitest";
import { SimulatedConnectAccountProvider } from "./SimulatedConnectAccountProvider.js";

const baseInput = { tenantId: "11111111-1111-1111-1111-111111111111", country: "US", email: "owner@example.com" };

describe("SimulatedConnectAccountProvider", () => {
  it("creates an account with no charges/payouts enabled and details not yet submitted", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const { accountId } = await provider.createAccount(baseInput);
    const details = await provider.retrieveAccount(accountId);

    expect(details).toEqual({
      accountId,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });

  it("mints a distinct account id per call", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const first = await provider.createAccount(baseInput);
    const second = await provider.createAccount(baseInput);

    expect(first.accountId).not.toBe(second.accountId);
  });

  it("createOnboardingLink rejects an unknown account id", async () => {
    const provider = new SimulatedConnectAccountProvider();
    await expect(
      provider.createOnboardingLink({
        accountId: "acct_unknown",
        refreshUrl: "https://app.example.com/refresh",
        returnUrl: "https://app.example.com/return",
      }),
    ).rejects.toThrow();
  });

  it("createOnboardingLink returns a future expiry and embeds the account id", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const { accountId } = await provider.createAccount(baseInput);
    const link = await provider.createOnboardingLink({
      accountId,
      refreshUrl: "https://app.example.com/refresh",
      returnUrl: "https://app.example.com/return",
    });

    expect(link.url).toContain(accountId);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("retrieveAccount rejects an unknown account id", async () => {
    const provider = new SimulatedConnectAccountProvider();
    await expect(provider.retrieveAccount("acct_unknown")).rejects.toThrow();
  });

  it("simulateOnboardingCompleted flips all three Stripe-reported flags to true", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const { accountId } = await provider.createAccount(baseInput);

    provider.simulateOnboardingCompleted(accountId);
    const details = await provider.retrieveAccount(accountId);

    expect(details.detailsSubmitted).toBe(true);
    expect(details.chargesEnabled).toBe(true);
    expect(details.payoutsEnabled).toBe(true);
  });

  it("simulateOnboardingCompleted rejects an unknown account id", () => {
    const provider = new SimulatedConnectAccountProvider();
    expect(() => provider.simulateOnboardingCompleted("acct_unknown")).toThrow();
  });
});
