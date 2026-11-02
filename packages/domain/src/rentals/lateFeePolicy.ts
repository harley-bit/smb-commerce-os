/**
 * `docs/design/05` "Late returns", step 5: "Apply late fees per the
 * variant's policy, on merchant confirmation." Steps 1-2 are `D081`'s
 * `LateReturnDetector`; steps 3-4 are `D082`'s `DownstreamConflictAlerts`.
 *
 * Pure domain math, no I/O — same shape as `authorizationWindow.ts`.
 * `computeLateFeeProposal` is the only way to price an overdue return, and
 * it can only ever produce a `PROPOSED` fee — there is no path from a
 * policy straight to a charge. `confirmLateFee` is the only function that
 * can turn a proposal into an `APPLIED` fee, and it requires an explicit
 * `confirmedByUserId` (the merchant taking the action) as an argument, not
 * something a caller can default or omit. This is what "no automatic
 * charge without merchant action" means structurally, not just by
 * convention: nothing in this module can reach `APPLIED` without a caller
 * supplying a real actor.
 */

export interface LateFeePolicy {
  /** Charge per full (or partial) billable day late, in minor currency units. Must be positive. */
  readonly perDayMinor: number;
  /** Hours after `ends_at` before any fee accrues. Defaults to 0 if omitted. */
  readonly graceHours?: number;
  /** Maximum total late fee, in minor units. Uncapped if omitted. */
  readonly capMinor?: number;
}

export interface LateFeeProposal {
  readonly status: "PROPOSED";
  readonly policy: LateFeePolicy;
  readonly overdueHours: number;
  readonly amountMinor: number;
}

export interface AppliedLateFee {
  readonly status: "APPLIED";
  readonly policy: LateFeePolicy;
  readonly overdueHours: number;
  readonly amountMinor: number;
  readonly confirmedByUserId: string;
  readonly confirmedAt: string;
}

export class InvalidLateFeePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLateFeePolicyError";
  }
}

export class InvalidLateFeeConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLateFeeConfirmationError";
  }
}

function assertValidPolicy(policy: LateFeePolicy): void {
  if (!Number.isFinite(policy.perDayMinor) || policy.perDayMinor <= 0) {
    throw new InvalidLateFeePolicyError(
      `perDayMinor must be a positive number, got ${policy.perDayMinor}.`,
    );
  }
  if (policy.graceHours !== undefined && (policy.graceHours < 0 || !Number.isFinite(policy.graceHours))) {
    throw new InvalidLateFeePolicyError(
      `graceHours must be a non-negative number, got ${policy.graceHours}.`,
    );
  }
  if (policy.capMinor !== undefined && (policy.capMinor < 0 || !Number.isFinite(policy.capMinor))) {
    throw new InvalidLateFeePolicyError(
      `capMinor must be a non-negative number, got ${policy.capMinor}.`,
    );
  }
}

/**
 * Prices an overdue return against a policy. Always returns a `PROPOSED`
 * fee — this is pricing, not billing. Some later, explicit merchant action
 * (`confirmLateFee`) is required before the amount means anything to a
 * payment provider.
 */
export function computeLateFeeProposal(policy: LateFeePolicy, overdueHours: number): LateFeeProposal {
  assertValidPolicy(policy);
  if (!Number.isFinite(overdueHours) || overdueHours < 0) {
    throw new InvalidLateFeePolicyError(
      `overdueHours must be a non-negative number, got ${overdueHours}.`,
    );
  }

  const graceHours = policy.graceHours ?? 0;
  const billableHours = Math.max(0, overdueHours - graceHours);
  const billableDays = Math.ceil(billableHours / 24);
  const rawAmountMinor = billableDays * policy.perDayMinor;
  const amountMinor =
    policy.capMinor !== undefined ? Math.min(rawAmountMinor, policy.capMinor) : rawAmountMinor;

  return { status: "PROPOSED", policy, overdueHours, amountMinor };
}

/**
 * The only path from a priced proposal to an applied (chargeable) fee.
 * Requires a real `confirmedByUserId` — the merchant confirming the
 * charge — and refuses to run twice against the same proposal shape.
 */
export function confirmLateFee(
  proposal: LateFeeProposal,
  confirmedByUserId: string,
  confirmedAt: string,
): AppliedLateFee {
  if (proposal.status !== "PROPOSED") {
    throw new InvalidLateFeeConfirmationError(
      "Only a PROPOSED late fee can be confirmed — this fee has already been applied.",
    );
  }
  if (!confirmedByUserId) {
    throw new InvalidLateFeeConfirmationError(
      "confirmLateFee requires a confirmedByUserId identifying the merchant who took the action.",
    );
  }
  if (!confirmedAt) {
    throw new InvalidLateFeeConfirmationError("confirmLateFee requires a confirmedAt timestamp.");
  }

  return {
    status: "APPLIED",
    policy: proposal.policy,
    overdueHours: proposal.overdueHours,
    amountMinor: proposal.amountMinor,
    confirmedByUserId,
    confirmedAt,
  };
}
