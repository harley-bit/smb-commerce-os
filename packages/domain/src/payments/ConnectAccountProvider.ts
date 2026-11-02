/**
 * `docs/cards/D087.md` — Stripe Connect platform-account seam, same shape
 * as `AuthProvider` (`../auth/AuthProvider.ts`) and `MediaUploadProvider`
 * (`../media/MediaUploadProvider.ts`): callers depend on this interface
 * only, so a real Stripe-backed implementation can swap in later without
 * touching `ConnectOnboardingService` or any other consumer. Every
 * implementation of this interface upholds `docs/design/07`'s "provider
 * holds funds" property — a connected account is created and onboarded
 * entirely on the provider's hosted flow, so this package never collects
 * or stores bank details, SSNs, or other underwriting data itself.
 */
export interface ConnectAccountDetails {
  readonly accountId: string;
  readonly detailsSubmitted: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
}

export interface ConnectOnboardingLink {
  readonly url: string;
  readonly expiresAt: string;
}

export interface CreateConnectAccountInput {
  readonly tenantId: string;
  readonly country: string;
  readonly email: string;
}

export interface CreateOnboardingLinkInput {
  readonly accountId: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
}

export interface ConnectAccountProvider {
  createAccount(input: CreateConnectAccountInput): Promise<{ accountId: string }>;
  createOnboardingLink(input: CreateOnboardingLinkInput): Promise<ConnectOnboardingLink>;
  retrieveAccount(accountId: string): Promise<ConnectAccountDetails>;
}
