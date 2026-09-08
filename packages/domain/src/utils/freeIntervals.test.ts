import { describe, expect, it } from "vitest";
import { computeFreeIntervals } from "./freeIntervals.js";
import type { AvailabilityException } from "./availabilityExceptions.js";
import type { Interval } from "./interval.js";

describe("computeFreeIntervals — base rule intervals minus exceptions minus blocking reservations", () => {
  const baseWednesday: Interval = {
    start: "2026-01-07T14:00:00.000Z",
    end: "2026-01-07T22:00:00.000Z",
  };

  it("returns the base intervals unchanged when there are no exceptions or reservations", () => {
    expect(computeFreeIntervals([baseWednesday], [], [])).toEqual([baseWednesday]);
  });

  it("applies exceptions exactly as applyAvailabilityExceptions would, when there are no reservations", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T16:00:00.000Z", end: "2026-01-07T18:00:00.000Z" },
      },
    ];
    expect(computeFreeIntervals([baseWednesday], exceptions, [])).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T16:00:00.000Z" },
      { start: "2026-01-07T18:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);
  });

  it("a blocking reservation fully covering the free interval removes it entirely", () => {
    const blocking: Interval[] = [
      { start: "2026-01-07T00:00:00.000Z", end: "2026-01-08T00:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], [], blocking)).toEqual([]);
  });

  it("a blocking reservation covering the middle of a free interval splits it in two", () => {
    const blocking: Interval[] = [
      { start: "2026-01-07T16:00:00.000Z", end: "2026-01-07T18:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], [], blocking)).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T16:00:00.000Z" },
      { start: "2026-01-07T18:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);
  });

  it("a blocking reservation that does not overlap any free interval leaves it untouched", () => {
    const blocking: Interval[] = [
      { start: "2026-01-08T00:00:00.000Z", end: "2026-01-08T02:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], [], blocking)).toEqual([baseWednesday]);
  });

  it("multiple blocking reservations are all subtracted, in any order", () => {
    const blocking: Interval[] = [
      { start: "2026-01-07T20:00:00.000Z", end: "2026-01-07T21:00:00.000Z" },
      { start: "2026-01-07T15:00:00.000Z", end: "2026-01-07T16:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], [], blocking)).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T15:00:00.000Z" },
      { start: "2026-01-07T16:00:00.000Z", end: "2026-01-07T20:00:00.000Z" },
      { start: "2026-01-07T21:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);
  });

  it("a blocking reservation is subtracted from an EXTRA one-off opening too, not just the base rule", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "EXTRA",
        interval: { start: "2026-01-10T14:00:00.000Z", end: "2026-01-10T18:00:00.000Z" },
      },
    ];
    const blocking: Interval[] = [
      { start: "2026-01-10T15:00:00.000Z", end: "2026-01-10T16:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], exceptions, blocking)).toEqual([
      baseWednesday,
      { start: "2026-01-10T14:00:00.000Z", end: "2026-01-10T15:00:00.000Z" },
      { start: "2026-01-10T16:00:00.000Z", end: "2026-01-10T18:00:00.000Z" },
    ]);
  });

  it("exceptions and reservations combine: BLACKOUT removes, EXTRA adds, then a reservation trims the result", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T18:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
      },
    ];
    const blocking: Interval[] = [
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T15:00:00.000Z" },
    ];
    expect(computeFreeIntervals([baseWednesday], exceptions, blocking)).toEqual([
      { start: "2026-01-07T15:00:00.000Z", end: "2026-01-07T18:00:00.000Z" },
    ]);
  });

  it("rejects a blocking reservation interval that is malformed", () => {
    expect(() =>
      computeFreeIntervals(
        [baseWednesday],
        [],
        [{ start: "not-a-date", end: "2026-01-07T22:00:00.000Z" }],
      ),
    ).toThrow();
  });

  it("the free/busy result carries no reservation identity — only start/end instants", () => {
    const blocking: Interval[] = [
      { start: "2026-01-07T16:00:00.000Z", end: "2026-01-07T18:00:00.000Z" },
    ];
    const result = computeFreeIntervals([baseWednesday], [], blocking);
    for (const interval of result) {
      expect(Object.keys(interval).sort()).toEqual(["end", "start"]);
    }
  });
});
