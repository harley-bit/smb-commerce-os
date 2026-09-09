import { describe, expect, it } from "vitest";
import { classifyDepositForDashboard, DEPOSIT_EXPIRING_SOON_WINDOW_HOURS } from "./depositDashboard.js";

describe("classifyDepositForDashboard", () => {
  const now = "2026-09-08T00:00:00.000Z";

  it("classifies RELEASED as RELEASED regardless of expiresAt", () => {
    expect(classifyDepositForDashboard("RELEASED", "2026-09-08T01:00:00.000Z", now)).toBe("RELEASED");
  });

  it("classifies CAPTURED as CAPTURED", () => {
    expect(classifyDepositForDashboard("CAPTURED", "2026-09-08T01:00:00.000Z", now)).toBe("CAPTURED");
  });

  it("classifies PARTIALLY_CAPTURED as CAPTURED", () => {
    expect(classifyDepositForDashboard("PARTIALLY_CAPTURED", "2026-09-08T01:00:00.000Z", now)).toBe("CAPTURED");
  });

  it("classifies EXPIRED as EXPIRED", () => {
    expect(classifyDepositForDashboard("EXPIRED", "2026-09-07T00:00:00.000Z", now)).toBe("EXPIRED");
  });

  it("classifies an AUTHORIZED hold well outside the expiring-soon window as HELD", () => {
    expect(classifyDepositForDashboard("AUTHORIZED", "2026-09-30T00:00:00.000Z", now)).toBe("HELD");
  });

  it("classifies an AUTHORIZED hold inside the default 72h window as EXPIRING_SOON", () => {
    expect(classifyDepositForDashboard("AUTHORIZED", "2026-09-10T00:00:00.000Z", now)).toBe("EXPIRING_SOON");
  });

  it("treats the window boundary itself as EXPIRING_SOON, not HELD", () => {
    const exactlyAtWindow = new Date(new Date(now).getTime() + DEPOSIT_EXPIRING_SOON_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    expect(classifyDepositForDashboard("AUTHORIZED", exactlyAtWindow, now)).toBe("EXPIRING_SOON");
  });

  it("classifies an AUTHORIZED hold already past its expiresAt as EXPIRING_SOON, not HELD", () => {
    expect(classifyDepositForDashboard("AUTHORIZED", "2026-09-01T00:00:00.000Z", now)).toBe("EXPIRING_SOON");
  });

  it("respects a caller-supplied window override", () => {
    expect(classifyDepositForDashboard("AUTHORIZED", "2026-09-09T00:00:00.000Z", now, 6)).toBe("HELD");
    expect(classifyDepositForDashboard("AUTHORIZED", "2026-09-08T03:00:00.000Z", now, 6)).toBe("EXPIRING_SOON");
  });
});
