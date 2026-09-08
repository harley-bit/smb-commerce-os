import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "./money.js";

describe("Money", () => {
  it("stores amount as integer minor units", () => {
    const m = Money.of(1050, "USD");
    expect(m.minorUnits).toBe(1050);
    expect(Number.isInteger(m.minorUnits)).toBe(true);
  });

  it("rejects a non-integer amount", () => {
    expect(() => Money.of(10.5, "USD")).toThrow(/integer/i);
  });

  it("rejects NaN and non-finite amounts", () => {
    expect(() => Money.of(Number.NaN, "USD")).toThrow();
    expect(() => Money.of(Number.POSITIVE_INFINITY, "USD")).toThrow();
  });

  it("rejects an empty currency code", () => {
    expect(() => Money.of(100, "")).toThrow(/currency/i);
  });

  it("adds two Money values of the same currency", () => {
    const a = Money.of(500, "USD");
    const b = Money.of(250, "USD");
    expect(a.add(b).minorUnits).toBe(750);
  });

  it("refuses to add across currencies", () => {
    const a = Money.of(500, "USD");
    const b = Money.of(250, "EUR");
    expect(() => a.add(b)).toThrow(/currency/i);
  });

  it("subtracts two Money values of the same currency", () => {
    const a = Money.of(500, "USD");
    const b = Money.of(250, "USD");
    expect(a.subtract(b).minorUnits).toBe(250);
  });

  it("multiplies by an integer factor", () => {
    const a = Money.of(500, "USD");
    expect(a.multiply(3).minorUnits).toBe(1500);
  });

  it("rejects multiplying by a non-integer factor", () => {
    const a = Money.of(500, "USD");
    expect(() => a.multiply(1.5)).toThrow(/integer/i);
  });

  it("compares equality by minor units and currency", () => {
    expect(Money.of(500, "USD").equals(Money.of(500, "USD"))).toBe(true);
    expect(Money.of(500, "USD").equals(Money.of(500, "EUR"))).toBe(false);
    expect(Money.of(500, "USD").equals(Money.of(400, "USD"))).toBe(false);
  });

  it("serializes to a plain object of integer minor units and currency", () => {
    expect(Money.of(500, "USD").toJSON()).toEqual({
      minorUnits: 500,
      currency: "USD",
    });
  });

  it("property: no float money — every constructed Money always holds an integer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.constantFrom("USD", "EUR", "GBP"),
        (amount, currency) => {
          const m = Money.of(amount, currency);
          expect(Number.isInteger(m.minorUnits)).toBe(true);
        },
      ),
    );
  });

  it("property: no float money — any non-integer amount is always rejected", () => {
    fc.assert(
      fc.property(
        fc.double({
          min: -1_000_000,
          max: 1_000_000,
          noNaN: true,
        }),
        (amount) => {
          fc.pre(!Number.isInteger(amount));
          expect(() => Money.of(amount, "USD")).toThrow(/integer/i);
        },
      ),
    );
  });

  it("property: add/subtract/multiply never produce a float result", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -100, max: 100 }),
        (a, b, factor) => {
          const ma = Money.of(a, "USD");
          const mb = Money.of(b, "USD");
          expect(Number.isInteger(ma.add(mb).minorUnits)).toBe(true);
          expect(Number.isInteger(ma.subtract(mb).minorUnits)).toBe(true);
          expect(Number.isInteger(ma.multiply(factor).minorUnits)).toBe(true);
        },
      ),
    );
  });
});
