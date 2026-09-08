import type { ConnectAccountDetails } from "./ConnectAccountProvider.js";

/**
 * Pure domain math, no I/O — same shape as `depositStateMachine.ts`. Derives
 * a merchant-facing onboarding status from the three flags Stripe reports on
 * a connected account, so no caller re-implements this logic (or gets it
 * wrong) at the route or job layer.
 *
 * `RESTRICTED` covers the "submitted but Stripe hasn't turned charges or
 * payouts on" case — e.g. still under review, or a requirement came due
 * after initial approval — distinct from `ONBOARDING`, where the merchant
 * has not yet finished the hosted flow at all.
 */
export type ConnectAccountStatus = "ONBOARDING" | "ACTIVE" | "RESTRICTED";

export function deriveConnectAccountStatus(
  details: Pick<ConnectAccountDetails, "detailsSubmitted" | "chargesEnabled" | "payoutsEnabled">,
): ConnectAccountStatus {
  if (!details.detailsSubmitted) {
    return "ONBOARDING";
  }
  if (details.chargesEnabled && details.payoutsEnabled) {
    return "ACTIVE";
  }
  return "RESTRICTED";
}
