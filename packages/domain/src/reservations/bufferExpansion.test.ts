import { describe, expect, it } from "vitest";
import { expandIntervalForBuffer } from "./bufferExpansion.js";

/**
 * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — the buffer is
 * applied by expanding the interval at write time: `effective_start =
 * requested_start`, `effective_end = requested_end + buffer_minutes`.
 */
describe("expandIntervalForBuffer", () => {
  it("leaves the interval unchanged when bufferMinutes is undefined", () => {
    const result = expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", undefined);
    expect(result).toEqual({ startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T10:00:00.000Z" });
  });

  it("leaves the interval unchanged when bufferMinutes is 0 or null", () => {
    expect(expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", 0)).toEqual({
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
    });
    expect(expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", null)).toEqual({
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
    });
  });

  it("expands only the end of the interval by bufferMinutes, leaving the start untouched", () => {
    const result = expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", 30);
    expect(result).toEqual({ startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T10:30:00.000Z" });
  });

  it("rejects a negative bufferMinutes", () => {
    expect(() => expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", -5)).toThrow();
  });

  it("rejects a non-integer bufferMinutes", () => {
    expect(() => expandIntervalForBuffer("2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", 5.5)).toThrow();
  });
});
