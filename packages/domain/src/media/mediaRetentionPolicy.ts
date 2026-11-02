/**
 * `docs/design/08` "Condition media — the hard case": condition media is
 * simultaneously evidence in a financial dispute and a liability that must
 * not accumulate indefinitely. The policy table there is exactly two rules:
 * 90 days after rental completion when no claim was ever filed, or 2 years
 * after a filed claim's resolution — never while a claim is still live or
 * disputed. Pure domain math, no I/O, same shape as `lateFeePolicy.ts`: the
 * job that walks real rows (`packages/db`'s `MediaRetentionJob`) is a thin
 * wrapper that fetches the inputs this function needs and does nothing else
 * with the retention decision itself.
 */

export const NO_CLAIM_RETENTION_DAYS = 90;
export const CLAIM_RESOLVED_RETENTION_YEARS = 2;

/**
 * `NONE` — rental completed, no damage claim was ever filed against this
 * order line. `LIVE` — a claim exists and has not yet reached a resolved or
 * disputed state (`DRAFT` / `FILED` / `CUSTOMER_NOTIFIED`). `DISPUTED` — a
 * claim is contested; per the design doc this can extend retention
 * indefinitely, so it is never eligible for deletion by this policy.
 * `RESOLVED` — the claim reached `RESOLVED_CAPTURED` or `RESOLVED_WAIVED`;
 * the 2-year clock starts at `resolvedAt`.
 */
export type MediaRetentionClaimStatus =
  | { readonly kind: "NONE" }
  | { readonly kind: "LIVE" }
  | { readonly kind: "DISPUTED" }
  | { readonly kind: "RESOLVED"; readonly resolvedAt: string };

export interface MediaRetentionInput {
  /** ISO timestamp of the rental's `CHECKIN` condition report — the "rental completion" signal, same as `DepositAutoReleaseJob`. */
  readonly rentalCompletedAt: string;
  readonly claimStatus: MediaRetentionClaimStatus;
}

export type MediaRetentionReason = "NO_CLAIM_90_DAYS" | "CLAIM_RESOLVED_2_YEARS";

export type MediaRetentionDecision =
  | { readonly eligible: false }
  | { readonly eligible: true; readonly reason: MediaRetentionReason };

const NOT_ELIGIBLE: MediaRetentionDecision = { eligible: false };

/**
 * Never eligible while a claim is live or disputed — no notion of "delete
 * anyway" exists in this function's return type. Deadlines are computed
 * calendar-wise (`setUTCDate`/`setUTCFullYear`) rather than by flat
 * millisecond arithmetic, so a 2-year deadline lands on the same
 * month/day two years later regardless of leap years in between.
 */
export function evaluateMediaRetention(input: MediaRetentionInput, now: Date): MediaRetentionDecision {
  switch (input.claimStatus.kind) {
    case "LIVE":
    case "DISPUTED":
      return NOT_ELIGIBLE;

    case "NONE": {
      const deadline = new Date(input.rentalCompletedAt);
      deadline.setUTCDate(deadline.getUTCDate() + NO_CLAIM_RETENTION_DAYS);
      return now.getTime() >= deadline.getTime()
        ? { eligible: true, reason: "NO_CLAIM_90_DAYS" }
        : NOT_ELIGIBLE;
    }

    case "RESOLVED": {
      const deadline = new Date(input.claimStatus.resolvedAt);
      deadline.setUTCFullYear(deadline.getUTCFullYear() + CLAIM_RESOLVED_RETENTION_YEARS);
      return now.getTime() >= deadline.getTime()
        ? { eligible: true, reason: "CLAIM_RESOLVED_2_YEARS" }
        : NOT_ELIGIBLE;
    }
  }
}
