import { describe, expect, it } from "vitest";
import { computeMonthWindow, monthLabel } from "./availabilityWindow";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const NINETY_DAY_CAP_MS = 90 * 24 * 60 * 60 * 1000;

describe("computeMonthWindow — D125 security check: 90-day request cap respected by the client", () => {
  it("the initial page (monthsAhead=0) starts at now, not the start of the calendar month", () => {
    const window = computeMonthWindow(NOW, 0);
    expect(window.from).toBe(NOW.toISOString());
    expect(window.to).toBe(new Date("2026-10-01T00:00:00.000Z").toISOString());
    expect(window.canGoNext).toBe(true);
  });

  it("a future page starts and ends on calendar-month boundaries", () => {
    const window = computeMonthWindow(NOW, 1);
    expect(window.from).toBe(new Date("2026-10-01T00:00:00.000Z").toISOString());
    expect(window.to).toBe(new Date("2026-11-01T00:00:00.000Z").toISOString());
    expect(window.canGoNext).toBe(true);
  });

  it("never lets `to` exceed 90 days from `now`, however far the client navigates forward", () => {
    const cap = new Date(NOW.getTime() + NINETY_DAY_CAP_MS);
    for (let monthsAhead = 0; monthsAhead < 12; monthsAhead += 1) {
      const window = computeMonthWindow(NOW, monthsAhead);
      expect(new Date(window.to).getTime()).toBeLessThanOrEqual(cap.getTime());
    }
  });

  it("reports canGoNext=false once the window has been clamped to the 90-day cap", () => {
    const cap = new Date(NOW.getTime() + NINETY_DAY_CAP_MS);
    let monthsAhead = 0;
    let window = computeMonthWindow(NOW, monthsAhead);
    while (window.canGoNext) {
      monthsAhead += 1;
      window = computeMonthWindow(NOW, monthsAhead);
    }
    expect(new Date(window.to).getTime()).toBe(cap.getTime());
  });

  it("monthLabel renders a human-readable UTC month/year", () => {
    expect(monthLabel(new Date("2026-09-01T00:00:00.000Z"))).toBe("September 2026");
    expect(monthLabel(new Date("2027-01-01T00:00:00.000Z"))).toBe("January 2027");
  });
});
