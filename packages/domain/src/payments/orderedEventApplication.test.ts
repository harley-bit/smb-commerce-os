import { describe, expect, it } from "vitest";
import { applyOrderedEvent, type OrderedApplicationState, type OrderedEvent } from "./orderedEventApplication.js";

type Status = "PENDING" | "SUCCEEDED" | "FAILED";

const INITIAL: OrderedApplicationState<Status> = { status: "PENDING", lastAppliedAt: null };

function fold(events: readonly OrderedEvent<Status>[]): OrderedApplicationState<Status> {
  return events.reduce(applyOrderedEvent, INITIAL);
}

describe("applyOrderedEvent (D093 — webhook ordering tolerance)", () => {
  it("applies a single event", () => {
    const result = applyOrderedEvent(INITIAL, { status: "SUCCEEDED", occurredAt: "2026-01-01T00:00:00.000Z" });
    expect(result).toEqual({ status: "SUCCEEDED", lastAppliedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("applies a later event on top of an earlier one, in chronological order", () => {
    const chronological: readonly OrderedEvent<Status>[] = [
      { status: "PENDING", occurredAt: "2026-01-01T00:00:00.000Z" },
      { status: "SUCCEEDED", occurredAt: "2026-01-01T00:05:00.000Z" },
    ];
    expect(fold(chronological)).toEqual({ status: "SUCCEEDED", lastAppliedAt: "2026-01-01T00:05:00.000Z" });
  });

  it("ignores an earlier event delivered after a later one — arrival order reversed", () => {
    const outOfOrder: readonly OrderedEvent<Status>[] = [
      { status: "SUCCEEDED", occurredAt: "2026-01-01T00:05:00.000Z" },
      { status: "PENDING", occurredAt: "2026-01-01T00:00:00.000Z" },
    ];
    expect(fold(outOfOrder)).toEqual({ status: "SUCCEEDED", lastAppliedAt: "2026-01-01T00:05:00.000Z" });
  });

  it("converges to the same final state regardless of arrival order, across every permutation", () => {
    const chronological: readonly OrderedEvent<Status>[] = [
      { status: "PENDING", occurredAt: "2026-01-01T00:00:00.000Z" },
      { status: "SUCCEEDED", occurredAt: "2026-01-01T00:05:00.000Z" },
      { status: "FAILED", occurredAt: "2026-01-01T00:10:00.000Z" },
    ];
    const expected = fold(chronological);

    for (const permutation of permutations(chronological)) {
      expect(fold(permutation)).toEqual(expected);
    }
  });

  it("treats a duplicate delivery of the same event (identical occurredAt) as a no-op", () => {
    const event: OrderedEvent<Status> = { status: "SUCCEEDED", occurredAt: "2026-01-01T00:05:00.000Z" };
    const once = applyOrderedEvent(INITIAL, event);
    const twice = applyOrderedEvent(once, event);
    expect(twice).toEqual(once);
  });

  it("a strictly later event with an unchanged status still advances lastAppliedAt", () => {
    const first = applyOrderedEvent(INITIAL, { status: "SUCCEEDED", occurredAt: "2026-01-01T00:05:00.000Z" });
    const second = applyOrderedEvent(first, { status: "SUCCEEDED", occurredAt: "2026-01-01T00:06:00.000Z" });
    expect(second).toEqual({ status: "SUCCEEDED", lastAppliedAt: "2026-01-01T00:06:00.000Z" });
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i]!, ...perm]);
    }
  }
  return result;
}
