/**
 * Timestamps are always UTC ISO-8601 strings ending in "Z" — see
 * docs/design/04, rule P5. Lexicographic comparison of that shape is
 * correct sort order, which is not true for offset-bearing timestamps.
 */
const UTC_ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function nowUtcIso(): string {
  return toUtcIso(new Date());
}

export function toUtcIso(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Cannot convert an invalid Date to a UTC ISO string");
  }
  return date.toISOString();
}

export function isUtcIso(value: string): boolean {
  return UTC_ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseUtcIso(value: string): Date {
  if (!isUtcIso(value)) {
    throw new Error(`Expected a UTC ISO-8601 string ending in "Z", got: ${value}`);
  }
  return new Date(value);
}
