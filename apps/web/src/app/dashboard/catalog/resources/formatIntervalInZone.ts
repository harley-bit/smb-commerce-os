export interface FreeInterval {
  start: string;
  end: string;
}

export interface FormattedInterval {
  date: string;
  startTime: string;
  endTime: string;
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    timeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * `docs/cards/D112.md` acceptance criterion — "Availability renders
 * correctly in merchant timezone" — and security check — "Timezone
 * handling verified across DST." `GET /resources/:id/availability`
 * (`apps/api/src/routes/resources.ts`) returns each free interval as a raw
 * UTC instant; this is the one place that instant gets converted to the
 * resource's own location's wall-clock time for display. Using
 * `Intl.DateTimeFormat` with an explicit IANA `timeZone` (never the
 * browser's local zone) means the correct UTC offset — including whether
 * DST is in effect on that particular date — is resolved fresh per
 * instant, the same DST-correctness property `packages/domain`'s
 * `expandAvailabilityRule` already proves on the write/expansion side
 * (`docs/logs/D046.md`); this function is its read-side counterpart.
 */
export function formatIntervalInZone(interval: FreeInterval, timeZone: string): FormattedInterval {
  const start = new Date(interval.start);
  const end = new Date(interval.end);
  return {
    date: dateFormatter(timeZone).format(start),
    startTime: timeFormatter(timeZone).format(start),
    endTime: timeFormatter(timeZone).format(end),
  };
}
