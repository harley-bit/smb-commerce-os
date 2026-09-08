import { type Interval, makeInterval } from "./interval.js";

/**
 * Weekly recurring availability rule — docs/design/03 `availability_rules`
 * table. Deliberately not a full RRULE: weekday plus a local time window is
 * enough for real merchant needs and far easier to reason about and test.
 */
export interface AvailabilityRule {
  /** 0 = Sunday .. 6 = Saturday, matching `Date#getUTCDay()`. */
  readonly weekday: number;
  /** Local wall-clock time, "HH:MM" (24h), in `timezone`. */
  readonly startTime: string;
  /** Local wall-clock time, "HH:MM" (24h), in `timezone`; strictly after `startTime`. */
  readonly endTime: string;
  /** IANA zone name, e.g. "America/New_York" — see `locations.timezone`, docs/design/03. */
  readonly timezone: string;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string): { hour: number; minute: number } {
  const match = TIME_RE.exec(value);
  if (!match) {
    throw new Error(`Expected time as "HH:MM" (24h), got: ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function localDateParts(instantMs: number, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Offset (ms) such that `utcInstantMs - offset` is the wall-clock time in `timeZone`. */
function zoneOffsetMs(timeZone: string, utcInstantMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcInstantMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcInstantMs;
}

/**
 * Converts a local wall-clock date+time in `timeZone` to the UTC instant it
 * denotes. This must iterate because the offset at an instant depends on the
 * instant itself (DST) — see docs/design/14 risk T23. DST offsets change in
 * whole steps (30/60 min), so a second lookup at the corrected instant always
 * converges; there is no fixed point to loop toward beyond that.
 */
function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zoneOffsetMs(timeZone, guess);
  const first = guess - offset;
  const offset2 = zoneOffsetMs(timeZone, first);
  return offset2 === offset ? first : guess - offset2;
}

/**
 * Expands a weekly availability rule into concrete UTC intervals, one per
 * matching local calendar date in [rangeStart, rangeEnd). Each endpoint's
 * offset is resolved independently at its own local date/time, so a window
 * spanning a DST transition produces the actually-elapsed UTC duration
 * rather than the wall-clock difference (D046 acceptance criteria).
 */
export function expandAvailabilityRule(
  rule: AvailabilityRule,
  rangeStart: string,
  rangeEnd: string,
): Interval[] {
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
    throw new Error(`Availability rule weekday must be an integer 0-6, got: ${rule.weekday}`);
  }
  const start = parseTime(rule.startTime);
  const end = parseTime(rule.endTime);
  if (start.hour * 60 + start.minute >= end.hour * 60 + end.minute) {
    throw new Error(
      `Availability rule startTime must be before endTime, got start=${rule.startTime} end=${rule.endTime}`,
    );
  }

  const rangeStartMs = Date.parse(rangeStart);
  const rangeEndMs = Date.parse(rangeEnd);
  if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeStartMs >= rangeEndMs) {
    throw new Error(`Invalid range: rangeStart must be a valid instant strictly before rangeEnd`);
  }

  const startLocal = localDateParts(rangeStartMs, rule.timezone);
  const endLocal = localDateParts(rangeEndMs, rule.timezone);
  // Pad a day on each side: local calendar dates near the range boundary can
  // still produce UTC intervals that overlap [rangeStart, rangeEnd).
  let cursorMs = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day) - DAY_MS;
  const walkEndMs = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day) + DAY_MS;

  const intervals: Interval[] = [];
  while (cursorMs <= walkEndMs) {
    const cursor = new Date(cursorMs);
    // getUTCDay() of a pure calendar date (constructed via Date.UTC from
    // already-localized y/m/d) is the correct local weekday, independent of
    // `timeZone` — day-of-week is a property of the calendar date itself.
    if (cursor.getUTCDay() === rule.weekday) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const day = cursor.getUTCDate();
      const startMs = zonedTimeToUtcMs(year, month, day, start.hour, start.minute, rule.timezone);
      const endMs = zonedTimeToUtcMs(year, month, day, end.hour, end.minute, rule.timezone);
      if (startMs < rangeEndMs && endMs > rangeStartMs) {
        intervals.push(makeInterval(new Date(startMs).toISOString(), new Date(endMs).toISOString()));
      }
    }
    cursorMs += DAY_MS;
  }

  return intervals;
}
