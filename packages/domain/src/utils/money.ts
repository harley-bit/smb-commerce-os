/**
 * Money is always represented as an integer count of minor currency units
 * (e.g. cents), never a float — see docs/design/04, rule P6. Floats cannot
 * exactly represent most decimal amounts, so any arithmetic on them silently
 * accumulates rounding error in a place where that error is real money.
 */
export class Money {
  readonly minorUnits: number;
  readonly currency: string;

  private constructor(minorUnits: number, currency: string) {
    this.minorUnits = minorUnits;
    this.currency = currency;
  }

  static of(minorUnits: number, currency: string): Money {
    if (!Number.isInteger(minorUnits)) {
      throw new Error(
        `Money amount must be an integer minor-unit value, got ${minorUnits}`,
      );
    }
    if (currency.trim().length === 0) {
      throw new Error("Money requires a non-empty currency code");
    }
    return new Money(minorUnits, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Cannot combine Money of different currency: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minorUnits - other.minorUnits, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new Error(`Money multiplier must be an integer, got ${factor}`);
    }
    return Money.of(this.minorUnits * factor, this.currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  toJSON(): { minorUnits: number; currency: string } {
    return { minorUnits: this.minorUnits, currency: this.currency };
  }
}
