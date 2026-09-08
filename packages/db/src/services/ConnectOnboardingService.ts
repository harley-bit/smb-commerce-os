import { deriveConnectAccountStatus, type ConnectAccountProvider, type ConnectAccountStatus } from "@smb-os/domain";

export interface StartOnboardingInput {
  readonly tenantId: string;
  readonly country: string;
  readonly email: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
}

export interface StartOnboardingResult {
  readonly accountId: string;
  readonly onboardingUrl: string;
  readonly expiresAt: string;
}

export interface ConnectAccountStatusResult {
  readonly accountId: string;
  readonly status: ConnectAccountStatus;
  readonly detailsSubmitted: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
}

/**
 * `docs/cards/D087.md` — platform-side orchestration of Stripe Connect
 * onboarding, behind the `ConnectAccountProvider` port (`@smb-os/domain`)
 * so this service never depends on a concrete Stripe SDK. No merchant ->
 * connected-account mapping is persisted yet — that's D088's "payments
 * schema wiring" — so today's caller is responsible for keeping the
 * returned `accountId` around; this card proves the onboarding mechanics
 * themselves, not durable storage of them.
 */
export class ConnectOnboardingService {
  constructor(private readonly provider: ConnectAccountProvider) {}

  async startOnboarding(input: StartOnboardingInput): Promise<StartOnboardingResult> {
    const { accountId } = await this.provider.createAccount({
      tenantId: input.tenantId,
      country: input.country,
      email: input.email,
    });
    const link = await this.provider.createOnboardingLink({
      accountId,
      refreshUrl: input.refreshUrl,
      returnUrl: input.returnUrl,
    });
    return { accountId, onboardingUrl: link.url, expiresAt: link.expiresAt };
  }

  async checkStatus(accountId: string): Promise<ConnectAccountStatusResult> {
    const details = await this.provider.retrieveAccount(accountId);
    return { ...details, status: deriveConnectAccountStatus(details) };
  }
}
