import { describe, expect, it } from "vitest";
import { formatIntervalInZone } from "./formatIntervalInZone";

describe("formatIntervalInZone — D112 security check: timezone handling verified across DST", () => {
  it("renders a pre-DST-transition UTC interval as 9am-5pm America/New_York (EST, UTC-5)", () => {
    // 2027-03-07 is a Sunday before the US spring-forward (2027-03-14).
    const result = formatIntervalInZone(
      { start: "2027-03-07T14:00:00.000Z", end: "2027-03-07T22:00:00.000Z" },
      "America/New_York",
    );
    expect(result.startTime).toBe("9:00 AM");
    expect(result.endTime).toBe("5:00 PM");
    expect(result.date).toBe("Sun, Mar 7, 2027");
  });

  it("renders a post-DST-transition UTC interval as the same 9am-5pm local wall time (EDT, UTC-4)", () => {
    // Same weekly rule, one week later — the UTC instants are shifted by an
    // hour relative to the pre-transition case, but the local wall-clock
    // rendering must be identical: proof the conversion tracks the zone's
    // real DST-in-effect offset for each instant, not a fixed UTC delta.
    const result = formatIntervalInZone(
      { start: "2027-03-14T13:00:00.000Z", end: "2027-03-14T21:00:00.000Z" },
      "America/New_York",
    );
    expect(result.startTime).toBe("9:00 AM");
    expect(result.endTime).toBe("5:00 PM");
    expect(result.date).toBe("Sun, Mar 14, 2027");
  });

  it("renders the same UTC interval differently for a merchant in a different timezone", () => {
    const interval = { start: "2027-03-07T14:00:00.000Z", end: "2027-03-07T22:00:00.000Z" };
    const eastCoast = formatIntervalInZone(interval, "America/New_York");
    const westCoast = formatIntervalInZone(interval, "America/Los_Angeles");
    expect(eastCoast.startTime).toBe("9:00 AM");
    expect(westCoast.startTime).toBe("6:00 AM");
  });

  it("handles a fall-back transition (repeated local hour) without shifting the displayed wall time", () => {
    // 2027-11-07 is the US fall-back date; a rule expanded on either side of
    // it should still show the same configured local 9am-5pm window.
    const before = formatIntervalInZone(
      { start: "2027-10-31T13:00:00.000Z", end: "2027-10-31T21:00:00.000Z" },
      "America/New_York",
    );
    const after = formatIntervalInZone(
      { start: "2027-11-07T14:00:00.000Z", end: "2027-11-07T22:00:00.000Z" },
      "America/New_York",
    );
    expect(before.startTime).toBe("9:00 AM");
    expect(after.startTime).toBe("9:00 AM");
  });
});
