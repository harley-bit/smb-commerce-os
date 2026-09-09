import { describe, expect, it } from "vitest";
import { classifyOrderTiming } from "./orderTiming.js";

const NOW = "2026-09-09T00:00:00.000Z";

describe("classifyOrderTiming", () => {
  it("classifies a PRODUCT-only order (no dated lines at all) as PAST", () => {
    const bucket = classifyOrderTiming([{ startsAt: null, endsAt: null }], NOW);
    expect(bucket).toBe("PAST");
  });

  it("classifies an order with a future SERVICE appointment as UPCOMING", () => {
    const bucket = classifyOrderTiming(
      [{ startsAt: "2026-09-10T09:00:00.000Z", endsAt: "2026-09-10T09:30:00.000Z" }],
      NOW,
    );
    expect(bucket).toBe("UPCOMING");
  });

  it("classifies an order with a past SERVICE appointment as PAST", () => {
    const bucket = classifyOrderTiming(
      [{ startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T09:30:00.000Z" }],
      NOW,
    );
    expect(bucket).toBe("PAST");
  });

  it("classifies a RENTAL still out (started but not yet returned) as UPCOMING", () => {
    const bucket = classifyOrderTiming(
      [{ startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-15T09:00:00.000Z" }],
      NOW,
    );
    expect(bucket).toBe("UPCOMING");
  });

  it("classifies a mixed-mode order as UPCOMING if any single line has a future date", () => {
    const bucket = classifyOrderTiming(
      [
        { startsAt: null, endsAt: null },
        { startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T09:30:00.000Z" },
        { startsAt: "2026-12-01T09:00:00.000Z", endsAt: "2026-12-02T09:00:00.000Z" },
      ],
      NOW,
    );
    expect(bucket).toBe("UPCOMING");
  });

  it("classifies a fully-elapsed mixed-mode order as PAST", () => {
    const bucket = classifyOrderTiming(
      [
        { startsAt: null, endsAt: null },
        { startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T09:30:00.000Z" },
      ],
      NOW,
    );
    expect(bucket).toBe("PAST");
  });

  it("treats a line ending exactly at `now` as no longer upcoming", () => {
    const bucket = classifyOrderTiming([{ startsAt: null, endsAt: NOW }], NOW);
    expect(bucket).toBe("PAST");
  });
});
