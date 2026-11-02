import { randomUUID } from "node:crypto";
import type { ConnectAccountDetails, ConnectAccountProvider, CreateConnectAccountInput, CreateOnboardingLinkInput } from "@smb-os/domain";

/**
 * `docs/cards/D087.md` — no Stripe platform account has been provisioned
 * for this project yet (the same "native now, real provider later"
 * situation D010/ADR-002 established for authentication and D073
 * established for object storage). This implementation models the
 * shape of Stripe Connect's onboarding flow — an account starts with
 * nothing enabled, only a hosted onboarding link moves it forward, and
 * `simulateOnboardingCompleted` stands in for the `account.updated`
 * webhook a real integration would receive once the merchant finishes
 * Stripe's hosted form — without holding or transmitting any real
 * underwriting data itself, upholding `docs/design/07`'s "provider holds
 * funds" property from day one.
 */
export class SimulatedConnectAccountProvider implements ConnectAccountProvider {
  private readonly accounts = new Map<string, ConnectAccountDetails>();

  async createAccount(input: CreateConnectAccountInput): Promise<{ accountId: string }> {
    void input;
    const accountId = `acct_${randomUUID()}`;
    this.accounts.set(accountId, {
      accountId,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    return { accountId };
  }

  async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<{ url: string; expiresAt: string }> {
    if (!this.accounts.has(input.accountId)) {
      throw new Error(`No connected account "${input.accountId}".`);
    }
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const url = new URL(`https://connect.simulated.stripe.example/onboarding/${input.accountId}`);
    url.searchParams.set("refresh_url", input.refreshUrl);
    url.searchParams.set("return_url", input.returnUrl);
    url.searchParams.set("expires", expiresAt);
    return { url: url.toString(), expiresAt };
  }

  async retrieveAccount(accountId: string): Promise<ConnectAccountDetails> {
    const details = this.accounts.get(accountId);
    if (!details) {
      throw new Error(`No connected account "${accountId}".`);
    }
    return details;
  }

  /** Test/simulation-only: stands in for Stripe's `account.updated` webhook reporting a finished hosted onboarding flow. */
  simulateOnboardingCompleted(accountId: string): void {
    const details = this.accounts.get(accountId);
    if (!details) {
      throw new Error(`No connected account "${accountId}".`);
    }
    this.accounts.set(accountId, {
      ...details,
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  }
}
