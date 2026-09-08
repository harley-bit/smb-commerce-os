import { describe, expect, it } from "vitest";
import { applyAvailabilityExceptions, type AvailabilityException } from "./availabilityExceptions.js";
import type { Interval } from "./interval.js";

describe("applyAvailabilityExceptions — BLACKOUT and EXTRA overrides on base rule intervals", () => {
  const baseWednesday: Interval = {
    start: "2026-01-07T14:00:00.000Z",
    end: "2026-01-07T22:00:00.000Z",
  };

  it("returns the base intervals unchanged when there are no exceptions", () => {
    expect(applyAvailabilityExceptions([baseWednesday], [])).toEqual([baseWednesday]);
  });

  it("BLACKOUT fully covering a base interval removes it entirely", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T00:00:00.000Z", end: "2026-01-08T00:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([]);
  });

  it("BLACKOUT covering the middle of a base interval splits it in two", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T16:00:00.000Z", end: "2026-01-07T18:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T16:00:00.000Z" },
      { start: "2026-01-07T18:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);
  });

  it("BLACKOUT trimming only the start or only the end shrinks the interval instead of splitting it", () => {
    const trimStart: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T13:00:00.000Z", end: "2026-01-07T15:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], trimStart)).toEqual([
      { start: "2026-01-07T15:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
    ]);

    const trimEnd: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T21:00:00.000Z", end: "2026-01-07T23:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], trimEnd)).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T21:00:00.000Z" },
    ]);
  });

  it("BLACKOUT that does not overlap the base interval leaves it untouched", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-08T00:00:00.000Z", end: "2026-01-08T02:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([baseWednesday]);
  });

  it("EXTRA adds a disjoint one-off opening as an additional available interval", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "EXTRA",
        interval: { start: "2026-01-10T14:00:00.000Z", end: "2026-01-10T16:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([
      baseWednesday,
      { start: "2026-01-10T14:00:00.000Z", end: "2026-01-10T16:00:00.000Z" },
    ]);
  });

  it("EXTRA that overlaps or abuts an existing available interval merges into one", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "EXTRA",
        interval: { start: "2026-01-07T22:00:00.000Z", end: "2026-01-07T23:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([
      { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T23:00:00.000Z" },
    ]);
  });

  it("BLACKOUT is applied before EXTRA, so a one-off opening survives a blackout on a different window", () => {
    const exceptions: AvailabilityException[] = [
      {
        kind: "BLACKOUT",
        interval: { start: "2026-01-07T14:00:00.000Z", end: "2026-01-07T22:00:00.000Z" },
      },
      {
        kind: "EXTRA",
        interval: { start: "2026-01-08T14:00:00.000Z", end: "2026-01-08T16:00:00.000Z" },
      },
    ];
    expect(applyAvailabilityExceptions([baseWednesday], exceptions)).toEqual([
      { start: "2026-01-08T14:00:00.000Z", end: "2026-01-08T16:00:00.000Z" },
    ]);
  });

  it("rejects an exception whose interval is malformed", () => {
    expect(() =>
      applyAvailabilityExceptions(
        [baseWednesday],
        [
          {
            kind: "BLACKOUT",
            interval: { start: "not-a-date", end: "2026-01-07T22:00:00.000Z" },
          },
        ],
      ),
    ).toThrow();
  });
});
