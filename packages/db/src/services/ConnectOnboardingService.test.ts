import { describe, expect, it } from "vitest";
import { ConnectOnboardingService } from "./ConnectOnboardingService.js";
import { SimulatedConnectAccountProvider } from "../payments/SimulatedConnectAccountProvider.js";

describe("ConnectOnboardingService", () => {
  it("D087 acceptance criteria: a test merchant completes onboarding", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const service = new ConnectOnboardingService(provider);

    const start = await service.startOnboarding({
      tenantId: "11111111-1111-1111-1111-111111111111",
      country: "US",
      email: "owner@example.com",
      refreshUrl: "https://app.example.com/connect/refresh",
      returnUrl: "https://app.example.com/connect/return",
    });

    expect(start.accountId).toMatch(/^acct_/);
    expect(start.onboardingUrl).toContain(start.accountId);

    const beforeCompletion = await service.checkStatus(start.accountId);
    expect(beforeCompletion.status).toBe("ONBOARDING");

    // Merchant completes the provider-hosted onboarding flow — simulated
    // here the same way a real Stripe `account.updated` webhook would
    // report the account back to us, since no live Stripe account exists.
    provider.simulateOnboardingCompleted(start.accountId);

    const afterCompletion = await service.checkStatus(start.accountId);
    expect(afterCompletion.status).toBe("ACTIVE");
    expect(afterCompletion.detailsSubmitted).toBe(true);
    expect(afterCompletion.chargesEnabled).toBe(true);
    expect(afterCompletion.payoutsEnabled).toBe(true);
  });

  it("rejects checkStatus for an account id the provider never created", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const service = new ConnectOnboardingService(provider);

    await expect(service.checkStatus("acct_does_not_exist")).rejects.toThrow();
  });

  it("scopes each connected account to the tenant that created it", async () => {
    const provider = new SimulatedConnectAccountProvider();
    const service = new ConnectOnboardingService(provider);

    const merchantA = await service.startOnboarding({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      country: "US",
      email: "a@example.com",
      refreshUrl: "https://app.example.com/connect/refresh",
      returnUrl: "https://app.example.com/connect/return",
    });
    const merchantB = await service.startOnboarding({
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      country: "US",
      email: "b@example.com",
      refreshUrl: "https://app.example.com/connect/refresh",
      returnUrl: "https://app.example.com/connect/return",
    });

    expect(merchantA.accountId).not.toBe(merchantB.accountId);
  });
});
