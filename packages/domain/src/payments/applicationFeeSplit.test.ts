import { describe, expect, it } from "vitest";
import { Money } from "../utils/money.js";
import { computeApplicationFeeSplit } from "./applicationFeeSplit.js";

describe("computeApplicationFeeSplit", () => {
  it("D089 acceptance criteria: splits a test transaction into a platform application fee and merchant proceeds that sum back to the total", () => {
    const orderTotal = Money.of(10_000, "USD");

    const split = computeApplicationFeeSplit(orderTotal, 250); // 2.5%

    expect(split.applicationFee.minorUnits).toBe(250);
    expect(split.merchantProceeds.minorUnits).toBe(9_750);
    expect(split.applicationFee.currency).toBe("USD");
    expect(split.merchantProceeds.currency).toBe("USD");
    expect(split.applicationFee.add(split.merchantProceeds).equals(orderTotal)).toBe(true);
  });

  it("rounds the fee to the nearest minor unit rather than losing or gaining a cent", () => {
    const orderTotal = Money.of(999, "USD");

    const split = computeApplicationFeeSplit(orderTotal, 250); // 24.975 -> rounds to 25

    expect(split.applicationFee.minorUnits).toBe(25);
    expect(split.merchantProceeds.minorUnits).toBe(974);
    expect(split.applicationFee.add(split.merchantProceeds).equals(orderTotal)).toBe(true);
  });

  it("a 0 bps take rate sends the entire total to the merchant", () => {
    const orderTotal = Money.of(5_000, "USD");

    const split = computeApplicationFeeSplit(orderTotal, 0);

    expect(split.applicationFee.minorUnits).toBe(0);
    expect(split.merchantProceeds.minorUnits).toBe(5_000);
  });

  it("a 10000 bps (100%) take rate sends the entire total to the platform", () => {
    const orderTotal = Money.of(5_000, "USD");

    const split = computeApplicationFeeSplit(orderTotal, 10_000);

    expect(split.applicationFee.minorUnits).toBe(5_000);
    expect(split.merchantProceeds.minorUnits).toBe(0);
  });

  it("rejects a negative take rate", () => {
    expect(() => computeApplicationFeeSplit(Money.of(1_000, "USD"), -1)).toThrow();
  });

  it("rejects a take rate above 10000 bps", () => {
    expect(() => computeApplicationFeeSplit(Money.of(1_000, "USD"), 10_001)).toThrow();
  });

  it("rejects a non-integer take rate", () => {
    expect(() => computeApplicationFeeSplit(Money.of(1_000, "USD"), 2.5)).toThrow();
  });
});
