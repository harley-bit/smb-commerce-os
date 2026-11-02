import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "./money.js";
import { assertLineTotal, computeLineTotal } from "./lineTotal.js";

describe("computeLineTotal", () => {
  it("multiplies unit price by quantity, in minor units", () => {
    const unitPrice = Money.of(1999, "USD");
    expect(computeLineTotal(unitPrice, 3).minorUnits).toBe(5997);
  });

  it("rejects a non-integer quantity", () => {
    const unitPrice = Money.of(1999, "USD");
    expect(() => computeLineTotal(unitPrice, 1.5)).toThrow(/integer/i);
  });

  it("rejects a non-positive quantity", () => {
    const unitPrice = Money.of(1999, "USD");
    expect(() => computeLineTotal(unitPrice, 0)).toThrow(/positive/i);
    expect(() => computeLineTotal(unitPrice, -2)).toThrow(/positive/i);
  });

  it("property: quantity x unit price equals line total, in minor units", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (unitPriceMinor, quantity) => {
          const unitPrice = Money.of(unitPriceMinor, "USD");
          const lineTotal = computeLineTotal(unitPrice, quantity);
          expect(Number.isInteger(lineTotal.minorUnits)).toBe(true);
          expect(lineTotal.minorUnits).toBe(unitPriceMinor * quantity);
        },
      ),
    );
  });
});

describe("assertLineTotal — invariant I8, asserted on write", () => {
  it("accepts a line total that matches quantity x unit price", () => {
    const unitPrice = Money.of(1999, "USD");
    const claimed = Money.of(5997, "USD");
    expect(() => assertLineTotal(unitPrice, 3, claimed)).not.toThrow();
  });

  it("rejects a line total that does not match quantity x unit price", () => {
    const unitPrice = Money.of(1999, "USD");
    const claimed = Money.of(6000, "USD");
    expect(() => assertLineTotal(unitPrice, 3, claimed)).toThrow(/I8|line total/i);
  });

  it("rejects a line total in a different currency", () => {
    const unitPrice = Money.of(1999, "USD");
    const claimed = Money.of(5997, "EUR");
    expect(() => assertLineTotal(unitPrice, 3, claimed)).toThrow();
  });

  it("property: any tampered claimed total is rejected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (unitPriceMinor, quantity, tamper) => {
          fc.pre(tamper !== 0);
          const unitPrice = Money.of(unitPriceMinor, "USD");
          const correct = unitPriceMinor * quantity;
          const claimed = Money.of(correct + tamper, "USD");
          expect(() => assertLineTotal(unitPrice, quantity, claimed)).toThrow();
        },
      ),
    );
  });
});
