/**
 * `docs/design/15` shows cancellation policy as something a merchant sets
 * per listing, alongside hours and blocked dates. Products, services, and
 * rentals cancel under genuinely different logic — a product cancellation
 * is about whether it has shipped, a service cancellation is about notice
 * before an appointment, a rental cancellation is about notice before the
 * pickup window and interacts with deposits. Collapsing all three into one
 * shared "cancellation policy" would either be wrong for two of the three
 * modes or would have to grow enough special cases to become unreadable.
 *
 * `CancellationPolicySet` requires `product`, `service`, and `rental` as
 * three separate, required fields — there is no shared/default policy a
 * caller can supply once and have it apply everywhere. `defineCancellationPolicySet`
 * additionally cross-checks that each policy's own `mode` tag matches the
 * key it was registered under, so a copy-pasted policy object (e.g. reusing
 * the service policy under the `rental` key by mistake) is rejected at
 * construction rather than silently applied to the wrong mode.
 * `resolveCancellationPolicy` is an exhaustive switch over `FulfillmentMode`
 * with no default branch, so there is no code path that falls through to a
 * shared rule.
 */

export type FulfillmentMode = "PRODUCT" | "SERVICE" | "RENTAL";

export interface CancellationTier {
  /** Refunds at this tier apply when cancelling at least this many hours before start. */
  readonly minHoursBeforeStart: number;
  /** Percentage of the amount refunded at this tier, 0-100. */
  readonly refundPercent: number;
}

export interface CancellationPolicy {
  readonly mode: FulfillmentMode;
  /** Must be sorted by `minHoursBeforeStart` descending, and non-empty. */
  readonly tiers: readonly CancellationTier[];
}

export interface CancellationRefundOutcome {
  readonly mode: FulfillmentMode;
  readonly hoursBeforeStart: number;
  readonly refundPercent: number;
  readonly refundAmountMinor: number;
}

export interface CancellationPolicySet {
  readonly product: CancellationPolicy;
  readonly service: CancellationPolicy;
  readonly rental: CancellationPolicy;
}

export class InvalidCancellationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCancellationPolicyError";
  }
}

export class InvalidCancellationPolicySetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCancellationPolicySetError";
  }
}

function assertValidPolicy(policy: CancellationPolicy): void {
  if (policy.tiers.length === 0) {
    throw new InvalidCancellationPolicyError(
      `${policy.mode} cancellation policy must have at least one tier.`,
    );
  }
  let previousThreshold = Number.POSITIVE_INFINITY;
  for (const tier of policy.tiers) {
    if (!Number.isFinite(tier.minHoursBeforeStart) || tier.minHoursBeforeStart < 0) {
      throw new InvalidCancellationPolicyError(
        `${policy.mode} tier minHoursBeforeStart must be a non-negative number, got ${tier.minHoursBeforeStart}.`,
      );
    }
    if (!Number.isFinite(tier.refundPercent) || tier.refundPercent < 0 || tier.refundPercent > 100) {
      throw new InvalidCancellationPolicyError(
        `${policy.mode} tier refundPercent must be between 0 and 100, got ${tier.refundPercent}.`,
      );
    }
    if (tier.minHoursBeforeStart >= previousThreshold) {
      throw new InvalidCancellationPolicyError(
        `${policy.mode} tiers must be sorted by minHoursBeforeStart in strictly descending order.`,
      );
    }
    previousThreshold = tier.minHoursBeforeStart;
  }
}

/**
 * Prices a cancellation against a single mode's policy. `hoursBeforeStart`
 * may be negative (cancelling after the start has already passed), in which
 * case no tier applies and the refund is zero unless the policy defines a
 * tier with `minHoursBeforeStart` of 0.
 */
export function computeCancellationRefund(
  policy: CancellationPolicy,
  hoursBeforeStart: number,
  amountMinor: number,
): CancellationRefundOutcome {
  assertValidPolicy(policy);
  if (!Number.isFinite(hoursBeforeStart)) {
    throw new InvalidCancellationPolicyError(
      `hoursBeforeStart must be a finite number, got ${hoursBeforeStart}.`,
    );
  }
  if (!Number.isFinite(amountMinor) || amountMinor < 0) {
    throw new InvalidCancellationPolicyError(
      `amountMinor must be a non-negative number, got ${amountMinor}.`,
    );
  }

  const tier = policy.tiers.find((candidate) => hoursBeforeStart >= candidate.minHoursBeforeStart);
  const refundPercent = tier?.refundPercent ?? 0;
  const refundAmountMinor = Math.round((amountMinor * refundPercent) / 100);

  return { mode: policy.mode, hoursBeforeStart, refundPercent, refundAmountMinor };
}

/**
 * The only constructor for a `CancellationPolicySet`. Requires all three
 * modes explicitly and rejects a policy registered under the wrong key
 * (its `mode` tag must match), so it is not possible to end up with one
 * policy silently governing more than one fulfillment mode.
 */
export function defineCancellationPolicySet(input: {
  readonly product: CancellationPolicy;
  readonly service: CancellationPolicy;
  readonly rental: CancellationPolicy;
}): CancellationPolicySet {
  assertValidPolicy(input.product);
  assertValidPolicy(input.service);
  assertValidPolicy(input.rental);

  if (input.product.mode !== "PRODUCT") {
    throw new InvalidCancellationPolicySetError(
      `The policy registered under "product" must have mode PRODUCT, got ${input.product.mode}.`,
    );
  }
  if (input.service.mode !== "SERVICE") {
    throw new InvalidCancellationPolicySetError(
      `The policy registered under "service" must have mode SERVICE, got ${input.service.mode}.`,
    );
  }
  if (input.rental.mode !== "RENTAL") {
    throw new InvalidCancellationPolicySetError(
      `The policy registered under "rental" must have mode RENTAL, got ${input.rental.mode}.`,
    );
  }

  return { product: input.product, service: input.service, rental: input.rental };
}

/** Exhaustive over `FulfillmentMode` — no default case, so no mode can fall through to a shared rule. */
export function resolveCancellationPolicy(
  policySet: CancellationPolicySet,
  mode: FulfillmentMode,
): CancellationPolicy {
  switch (mode) {
    case "PRODUCT":
      return policySet.product;
    case "SERVICE":
      return policySet.service;
    case "RENTAL":
      return policySet.rental;
  }
}
