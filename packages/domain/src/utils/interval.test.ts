import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { intervalsOverlap, makeInterval } from "./interval.js";

const iso = (s: string): string => s;

describe("Interval — half-open [start, end)", () => {
  it("makeInterval accepts start strictly before end", () => {
    const i = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:00.000Z"),
    );
    expect(i.start).toBe("2026-01-15T10:00:00.000Z");
    expect(i.end).toBe("2026-01-15T11:00:00.000Z");
  });

  it("makeInterval rejects start equal to end (zero-length)", () => {
    expect(() =>
      makeInterval(
        iso("2026-01-15T10:00:00.000Z"),
        iso("2026-01-15T10:00:00.000Z"),
      ),
    ).toThrow(/start.*before.*end/i);
  });

  it("makeInterval rejects start after end", () => {
    expect(() =>
      makeInterval(
        iso("2026-01-15T11:00:00.000Z"),
        iso("2026-01-15T10:00:00.000Z"),
      ),
    ).toThrow(/start.*before.*end/i);
  });

  it("makeInterval rejects a non-UTC-ISO start", () => {
    expect(() =>
      makeInterval("not a date", iso("2026-01-15T11:00:00.000Z")),
    ).toThrow(/UTC/i);
  });

  it("makeInterval rejects a non-UTC-ISO end", () => {
    expect(() =>
      makeInterval(iso("2026-01-15T10:00:00.000Z"), "not a date"),
    ).toThrow(/UTC/i);
  });

  it("adjacent intervals (a.end === b.start) do not conflict", () => {
    const a = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:00.000Z"),
    );
    const b = makeInterval(
      iso("2026-01-15T11:00:00.000Z"),
      iso("2026-01-15T12:00:00.000Z"),
    );
    expect(intervalsOverlap(a, b)).toBe(false);
    expect(intervalsOverlap(b, a)).toBe(false);
  });

  it("a 1-second overlap does conflict", () => {
    const a = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:01.000Z"),
    );
    const b = makeInterval(
      iso("2026-01-15T11:00:00.000Z"),
      iso("2026-01-15T12:00:00.000Z"),
    );
    expect(intervalsOverlap(a, b)).toBe(true);
    expect(intervalsOverlap(b, a)).toBe(true);
  });

  it("identical intervals conflict", () => {
    const a = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:00.000Z"),
    );
    expect(intervalsOverlap(a, a)).toBe(true);
  });

  it("one interval fully containing another conflicts", () => {
    const outer = makeInterval(
      iso("2026-01-15T09:00:00.000Z"),
      iso("2026-01-15T12:00:00.000Z"),
    );
    const inner = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:00.000Z"),
    );
    expect(intervalsOverlap(outer, inner)).toBe(true);
    expect(intervalsOverlap(inner, outer)).toBe(true);
  });

  it("disjoint intervals with a gap do not conflict", () => {
    const a = makeInterval(
      iso("2026-01-15T10:00:00.000Z"),
      iso("2026-01-15T11:00:00.000Z"),
    );
    const b = makeInterval(
      iso("2026-01-15T11:00:01.000Z"),
      iso("2026-01-15T12:00:00.000Z"),
    );
    expect(intervalsOverlap(a, b)).toBe(false);
    expect(intervalsOverlap(b, a)).toBe(false);
  });

  it("property: overlap is symmetric for any two valid intervals", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000 })),
        fc.tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000 })),
        ([aStart, aLen], [bStart, bLen]) => {
          const base = Date.UTC(2026, 0, 1, 0, 0, 0);
          const a = makeInterval(
            new Date(base + aStart * 1000).toISOString(),
            new Date(base + (aStart + aLen) * 1000).toISOString(),
          );
          const b = makeInterval(
            new Date(base + bStart * 1000).toISOString(),
            new Date(base + (bStart + bLen) * 1000).toISOString(),
          );
          expect(intervalsOverlap(a, b)).toBe(intervalsOverlap(b, a));
        },
      ),
    );
  });
});
