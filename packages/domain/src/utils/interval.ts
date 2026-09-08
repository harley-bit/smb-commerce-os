import { isUtcIso } from "./time.js";

/**
 * Half-open interval [start, end) over UTC ISO-8601 instants — see
 * docs/design/04, rule P5. Half-open means an interval ending exactly
 * where another begins does not overlap it (D045 acceptance criteria).
 */
export interface Interval {
  readonly start: string;
  readonly end: string;
}

export function makeInterval(start: string, end: string): Interval {
  if (!isUtcIso(start)) {
    throw new Error(`Interval start must be a UTC ISO-8601 string, got: ${start}`);
  }
  if (!isUtcIso(end)) {
    throw new Error(`Interval end must be a UTC ISO-8601 string, got: ${end}`);
  }
  if (Date.parse(start) >= Date.parse(end)) {
    throw new Error(
      `Interval start must be strictly before end, got start=${start} end=${end}`,
    );
  }
  return { start, end };
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}
