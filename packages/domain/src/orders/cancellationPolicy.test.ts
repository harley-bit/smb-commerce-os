import { describe, expect, it } from "vitest";
import {
  computeCancellationRefund,
  defineCancellationPolicySet,
  resolveCancellationPolicy,
  InvalidCancellationPolicyError,
  InvalidCancellationPolicySetError,
  type CancellationPolicy,
} from "./cancellationPolicy.js";

const productPolicy: CancellationPolicy = {
  mode: "PRODUCT",
  tiers: [{ minHoursBeforeStart: 0, refundPercent: 100 }],
};

const servicePolicy: CancellationPolicy = {
  mode: "SERVICE",
  tiers: [
    { minHoursBeforeStart: 24, refundPercent: 100 },
    { minHoursBeforeStart: 2, refundPercent: 50 },
    { minHoursBeforeStart: 0, refundPercent: 0 },
  ],
};

const rentalPolicy: CancellationPolicy = {
  mode: "RENTAL",
  tiers: [
    { minHoursBeforeStart: 72, refundPercent: 100 },
    { minHoursBeforeStart: 24, refundPercent: 75 },
    { minHoursBeforeStart: 0, refundPercent: 25 },
  ],
};

describe("computeCancellationRefund", () => {
  it("refunds in full for a product cancelled any time before fulfillment", () => {
    const outcome = computeCancellationRefund(productPolicy, 1, 10_000);
    expect(outcome.refundPercent).toBe(100);
    expect(outcome.refundAmountMinor).toBe(10_000);
  });

  it("applies the tier matching notice given for a service appointment", () => {
    expect(computeCancellationRefund(servicePolicy, 48, 10_000).refundPercent).toBe(100);
    expect(computeCancellationRefund(servicePolicy, 5, 10_000).refundPercent).toBe(50);
    expect(computeCancellationRefund(servicePolicy, 0, 10_000).refundPercent).toBe(0);
  });

  it("applies the rental tier, which has different thresholds than the service policy", () => {
    expect(computeCancellationRefund(rentalPolicy, 100, 10_000).refundPercent).toBe(100);
    expect(computeCancellationRefund(rentalPolicy, 30, 10_000).refundPercent).toBe(75);
    expect(computeCancellationRefund(rentalPolicy, 1, 10_000).refundPercent).toBe(25);
  });

  it("refunds nothing when cancelling after start with no matching tier", () => {
    const outcome = computeCancellationRefund(servicePolicy, -5, 10_000);
    expect(outcome.refundPercent).toBe(0);
    expect(outcome.refundAmountMinor).toBe(0);
  });

  it("rejects a policy with no tiers", () => {
    expect(() =>
      computeCancellationRefund({ mode: "PRODUCT", tiers: [] }, 1, 10_000),
    ).toThrow(InvalidCancellationPolicyError);
  });

  it("rejects tiers not sorted in strictly descending order", () => {
    const badPolicy: CancellationPolicy = {
      mode: "SERVICE",
      tiers: [
        { minHoursBeforeStart: 2, refundPercent: 50 },
        { minHoursBeforeStart: 24, refundPercent: 100 },
      ],
    };
    expect(() => computeCancellationRefund(badPolicy, 30, 10_000)).toThrow(
      InvalidCancellationPolicyError,
    );
  });

  it("rejects a negative amount", () => {
    expect(() => computeCancellationRefund(productPolicy, 1, -1)).toThrow(
      InvalidCancellationPolicyError,
    );
  });

  it("rejects a tier with an out-of-range refundPercent", () => {
    const badPolicy: CancellationPolicy = {
      mode: "PRODUCT",
      tiers: [{ minHoursBeforeStart: 0, refundPercent: 150 }],
    };
    expect(() => computeCancellationRefund(badPolicy, 1, 10_000)).toThrow(
      InvalidCancellationPolicyError,
    );
  });

  it("rejects a non-finite hoursBeforeStart", () => {
    expect(() => computeCancellationRefund(productPolicy, Number.NaN, 10_000)).toThrow(
      InvalidCancellationPolicyError,
    );
  });
});

describe("defineCancellationPolicySet", () => {
  it("accepts three distinct, independently-shaped policies, one per mode", () => {
    const set = defineCancellationPolicySet({
      product: productPolicy,
      service: servicePolicy,
      rental: rentalPolicy,
    });
    expect(resolveCancellationPolicy(set, "PRODUCT")).toBe(productPolicy);
    expect(resolveCancellationPolicy(set, "SERVICE")).toBe(servicePolicy);
    expect(resolveCancellationPolicy(set, "RENTAL")).toBe(rentalPolicy);
  });

  it("rejects a policy registered under the wrong mode key (no single rule can cover two modes)", () => {
    expect(() =>
      defineCancellationPolicySet({
        product: productPolicy,
        service: rentalPolicy,
        rental: rentalPolicy,
      }),
    ).toThrow(InvalidCancellationPolicySetError);
  });

  it("rejects a mismatched product policy", () => {
    expect(() =>
      defineCancellationPolicySet({
        product: servicePolicy,
        service: servicePolicy,
        rental: rentalPolicy,
      }),
    ).toThrow(InvalidCancellationPolicySetError);
  });

  it("rejects a mismatched rental policy", () => {
    expect(() =>
      defineCancellationPolicySet({
        product: productPolicy,
        service: servicePolicy,
        rental: servicePolicy,
      }),
    ).toThrow(InvalidCancellationPolicySetError);
  });

  it("cannot be constructed with only some modes configured", () => {
    expect(() =>
      // @ts-expect-error -- rental deliberately omitted to prove the type requires all three
      defineCancellationPolicySet({ product: productPolicy, service: servicePolicy }),
    ).toThrow();
  });
});
