import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isUtcIso, nowUtcIso, parseUtcIso, toUtcIso } from "./time.js";

describe("UTC time helpers", () => {
  it("nowUtcIso returns a UTC ISO-8601 string ending in Z", () => {
    const ts = nowUtcIso();
    expect(ts).toMatch(/Z$/);
    expect(isUtcIso(ts)).toBe(true);
  });

  it("toUtcIso converts a Date to a UTC ISO-8601 string", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12, 30, 0));
    expect(toUtcIso(d)).toBe("2026-01-15T12:30:00.000Z");
  });

  it("toUtcIso rejects an invalid Date", () => {
    expect(() => toUtcIso(new Date("not a date"))).toThrow(/invalid date/i);
  });

  it("isUtcIso rejects a non-UTC offset", () => {
    expect(isUtcIso("2026-01-15T12:30:00.000+02:00")).toBe(false);
  });

  it("isUtcIso rejects a bare date with no time/offset", () => {
    expect(isUtcIso("2026-01-15")).toBe(false);
  });

  it("isUtcIso rejects garbage input", () => {
    expect(isUtcIso("not a date")).toBe(false);
  });

  it("parseUtcIso round-trips a UTC ISO string back to the same instant", () => {
    const ts = "2026-01-15T12:30:00.000Z";
    expect(parseUtcIso(ts).getTime()).toBe(Date.parse(ts));
  });

  it("parseUtcIso rejects a non-UTC string", () => {
    expect(() => parseUtcIso("2026-01-15T12:30:00.000+02:00")).toThrow(
      /UTC/i,
    );
  });

  it("property: all timestamps UTC — toUtcIso always ends in Z and round-trips", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("1990-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        }),
        (d) => {
          const iso = toUtcIso(d);
          expect(iso.endsWith("Z")).toBe(true);
          expect(isUtcIso(iso)).toBe(true);
          expect(parseUtcIso(iso).getTime()).toBe(d.getTime());
        },
      ),
    );
  });
});
