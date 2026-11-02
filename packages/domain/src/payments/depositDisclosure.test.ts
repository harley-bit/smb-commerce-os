import { describe, expect, it } from "vitest";
import {
  buildDepositDisclosure,
  DEPOSIT_HOLD_CONDITIONS,
  InvalidDepositHoldIntervalError,
  NoDepositToDiscloseError,
} from "./depositDisclosure.js";

describe("buildDepositDisclosure", () => {
  it("computes hold amount, duration in whole days, and the standard conditions", () => {
    const disclosure = buildDepositDisclosure({
      depositMinor: 15000,
      currency: "usd",
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-13T00:00:00.000Z",
    });

    expect(disclosure).toEqual({
      holdAmountMinor: 15000,
      currency: "usd",
      holdDurationDays: 3,
      conditions: DEPOSIT_HOLD_CONDITIONS,
    });
  });

  it("rounds a partial-day interval up to a whole day", () => {
    const disclosure = buildDepositDisclosure({
      depositMinor: 5000,
      currency: "usd",
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-10T12:00:00.000Z",
    });

    expect(disclosure.holdDurationDays).toBe(1);
  });

  it("throws NoDepositToDiscloseError for a zero deposit", () => {
    expect(() =>
      buildDepositDisclosure({
        depositMinor: 0,
        currency: "usd",
        startsAt: "2026-09-10T00:00:00.000Z",
        endsAt: "2026-09-13T00:00:00.000Z",
      }),
    ).toThrow(NoDepositToDiscloseError);
  });

  it("throws NoDepositToDiscloseError for a negative deposit", () => {
    expect(() =>
      buildDepositDisclosure({
        depositMinor: -100,
        currency: "usd",
        startsAt: "2026-09-10T00:00:00.000Z",
        endsAt: "2026-09-13T00:00:00.000Z",
      }),
    ).toThrow(NoDepositToDiscloseError);
  });

  it("throws InvalidDepositHoldIntervalError when endsAt is not after startsAt", () => {
    expect(() =>
      buildDepositDisclosure({
        depositMinor: 5000,
        currency: "usd",
        startsAt: "2026-09-13T00:00:00.000Z",
        endsAt: "2026-09-10T00:00:00.000Z",
      }),
    ).toThrow(InvalidDepositHoldIntervalError);
  });

  it("throws InvalidDepositHoldIntervalError when the interval is missing", () => {
    expect(() =>
      buildDepositDisclosure({
        depositMinor: 5000,
        currency: "usd",
        startsAt: "",
        endsAt: "",
      }),
    ).toThrow(InvalidDepositHoldIntervalError);
  });

  it("always returns the same standard conditions array, not caller-suppliable", () => {
    const disclosure = buildDepositDisclosure({
      depositMinor: 5000,
      currency: "usd",
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-11T00:00:00.000Z",
    });
    expect(disclosure.conditions).toBe(DEPOSIT_HOLD_CONDITIONS);
  });
});
