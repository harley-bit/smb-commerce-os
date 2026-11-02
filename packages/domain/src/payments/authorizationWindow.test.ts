import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_WINDOW_CEILING_DAYS,
  InvalidAuthorizationWindowError,
  RentalTermExceedsAuthorizationWindowError,
  recordProviderAuthorizationWindow,
  validateRentalTermAgainstAuthorizationWindow,
} from "./authorizationWindow.js";

describe("recordProviderAuthorizationWindow", () => {
  it("records a standard 7-day window", () => {
    expect(recordProviderAuthorizationWindow(7)).toEqual({ providerWindowDays: 7 });
  });

  it("records the extended 30-day lodging/vehicle-rental MCC window", () => {
    expect(recordProviderAuthorizationWindow(30)).toEqual({ providerWindowDays: 30 });
  });

  it("rejects zero", () => {
    expect(() => recordProviderAuthorizationWindow(0)).toThrow(InvalidAuthorizationWindowError);
  });

  it("rejects a negative window", () => {
    expect(() => recordProviderAuthorizationWindow(-1)).toThrow(InvalidAuthorizationWindowError);
  });

  it("rejects a non-integer window", () => {
    expect(() => recordProviderAuthorizationWindow(7.5)).toThrow(InvalidAuthorizationWindowError);
  });

  it("rejects a window beyond the 30-day product ceiling (docs/design/05)", () => {
    expect(() => recordProviderAuthorizationWindow(31)).toThrow(InvalidAuthorizationWindowError);
  });

  it("AUTHORIZATION_WINDOW_CEILING_DAYS is 30, matching the documented hard product constraint", () => {
    expect(AUTHORIZATION_WINDOW_CEILING_DAYS).toBe(30);
  });
});

describe("validateRentalTermAgainstAuthorizationWindow", () => {
  const standardWindow = recordProviderAuthorizationWindow(7);
  const extendedWindow = recordProviderAuthorizationWindow(30);

  it("accepts a rental term within the window", () => {
    expect(() => validateRentalTermAgainstAuthorizationWindow(5, standardWindow)).not.toThrow();
  });

  it("accepts a rental term exactly at the window boundary", () => {
    expect(() => validateRentalTermAgainstAuthorizationWindow(7, standardWindow)).not.toThrow();
  });

  it("rejects a rental term one day beyond a standard 7-day window", () => {
    expect(() => validateRentalTermAgainstAuthorizationWindow(8, standardWindow)).toThrow(
      RentalTermExceedsAuthorizationWindowError,
    );
  });

  it("rejects a rental term beyond an extended 30-day window", () => {
    expect(() => validateRentalTermAgainstAuthorizationWindow(31, extendedWindow)).toThrow(
      RentalTermExceedsAuthorizationWindowError,
    );
  });

  it("error message carries actionable guidance — captured deposit or contractual claims process", () => {
    try {
      validateRentalTermAgainstAuthorizationWindow(10, standardWindow);
      throw new Error("expected validateRentalTermAgainstAuthorizationWindow to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RentalTermExceedsAuthorizationWindowError);
      const exceeded = error as RentalTermExceedsAuthorizationWindowError;
      expect(exceeded.rentalTermDays).toBe(10);
      expect(exceeded.window).toEqual(standardWindow);
      expect(exceeded.message).toMatch(/7-day/);
      expect(exceeded.message).toMatch(/captured deposit/i);
      expect(exceeded.message).toMatch(/contractual claims/i);
    }
  });

  it("rejects a non-positive rental term", () => {
    expect(() => validateRentalTermAgainstAuthorizationWindow(0, standardWindow)).toThrow(
      RentalTermExceedsAuthorizationWindowError,
    );
  });
});
