import { describe, expect, it } from "vitest";
import { expandAvailabilityRule } from "./availabilityRule.js";

describe("expandAvailabilityRule — weekday + local time window to UTC intervals", () => {
  it("expands a plain non-DST weekday window using the standard offset", () => {
    // Wednesday 2026-01-07, America/New_York is on EST (UTC-5) in January.
    const intervals = expandAvailabilityRule(
      { weekday: 3, startTime: "09:00", endTime: "17:00", timezone: "America/New_York" },
      "2026-01-05T00:00:00.000Z",
      "2026-01-12T00:00:00.000Z",
    );
    expect(intervals).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);
  });

  it("only emits intervals on the matching weekday, not every day in range", () => {
    const intervals = expandAvailabilityRule(
      { weekday: 3, startTime: "09:00", endTime: "17:00", timezone: "America/New_York" },
      "2026-01-05T00:00:00.000Z",
      "2026-01-19T00:00:00.000Z",
    );
    expect(intervals).toHaveLength(2);
    expect(intervals[0]!.start).toBe("2026-01-07T14:00:00.000Z");
    expect(intervals[1]!.start).toBe("2026-01-14T14:00:00.000Z");
  });

  it("spring-forward: a window crossing the DST gap reflects real elapsed time, not wall-clock diff", () => {
    // 2024-03-10 is a Sunday in America/New_York; clocks jump 02:00 -> 03:00.
    // Wall clock start=01:00 to end=03:30 looks like 2.5h but only 1.5h actually elapses.
    const intervals = expandAvailabilityRule(
      { weekday: 0, startTime: "01:00", endTime: "03:30", timezone: "America/New_York" },
      "2024-03-09T00:00:00.000Z",
      "2024-03-11T00:00:00.000Z",
    );
    expect(intervals).toEqual([
      { start: "2024-03-10T06:00:00.000Z", end: "2024-03-10T07:30:00.000Z" },
    ]);
    const [interval] = intervals;
    const durationMs = Date.parse(interval!.end) - Date.parse(interval!.start);
    expect(durationMs).toBe(1.5 * 60 * 60 * 1000);
  });

  it("fall-back: a window crossing the DST repeat reflects real elapsed time, not wall-clock diff", () => {
    // 2024-11-03 is a Sunday in America/New_York; clocks repeat 01:00-02:00 (fall back at 02:00 -> 01:00).
    // Wall clock start=00:30 to end=02:30 looks like 2h but 3h actually elapses.
    const intervals = expandAvailabilityRule(
      { weekday: 0, startTime: "00:30", endTime: "02:30", timezone: "America/New_York" },
      "2024-11-02T00:00:00.000Z",
      "2024-11-04T00:00:00.000Z",
    );
    expect(intervals).toEqual([
      { start: "2024-11-03T04:30:00.000Z", end: "2024-11-03T07:30:00.000Z" },
    ]);
    const [interval] = intervals;
    const durationMs = Date.parse(interval!.end) - Date.parse(interval!.start);
    expect(durationMs).toBe(3 * 60 * 60 * 1000);
  });

  it("rejects a startTime not strictly before endTime", () => {
    expect(() =>
      expandAvailabilityRule(
        { weekday: 1, startTime: "17:00", endTime: "09:00", timezone: "America/New_York" },
        "2026-01-05T00:00:00.000Z",
        "2026-01-12T00:00:00.000Z",
      ),
    ).toThrow(/startTime.*before.*endTime/i);
  });

  it("rejects a malformed time string", () => {
    expect(() =>
      expandAvailabilityRule(
        { weekday: 1, startTime: "9:00", endTime: "17:00", timezone: "America/New_York" },
        "2026-01-05T00:00:00.000Z",
        "2026-01-12T00:00:00.000Z",
      ),
    ).toThrow(/HH:MM/);
  });

  it("rejects an out-of-range weekday", () => {
    expect(() =>
      expandAvailabilityRule(
        { weekday: 7, startTime: "09:00", endTime: "17:00", timezone: "America/New_York" },
        "2026-01-05T00:00:00.000Z",
        "2026-01-12T00:00:00.000Z",
      ),
    ).toThrow(/weekday/i);
  });

  it("produces intervals valid under makeInterval's half-open contract (start strictly before end)", () => {
    const intervals = expandAvailabilityRule(
      { weekday: 3, startTime: "09:00", endTime: "17:00", timezone: "Australia/Lord_Howe" },
      "2026-01-05T00:00:00.000Z",
      "2026-01-12T00:00:00.000Z",
    );
    // Lord Howe uses a 30-minute DST offset — an unusual case that would break
    // an implementation assuming whole-hour DST shifts.
    expect(intervals).toHaveLength(1);
    expect(Date.parse(intervals[0]!.start)).toBeLessThan(Date.parse(intervals[0]!.end));
  });
});
