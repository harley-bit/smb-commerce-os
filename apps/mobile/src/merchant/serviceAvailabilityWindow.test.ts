import { describe, expect, it } from "vitest";
import { computeServiceAvailabilityWindow } from "./serviceAvailabilityWindow.js";

describe("computeServiceAvailabilityWindow — pure 14-day availability window (docs/cards/D143.md)", () => {
  it("returns a 14-day window starting now", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");

    const window = computeServiceAvailabilityWindow(now);

    expect(window).toEqual({ from: "2026-09-10T00:00:00.000Z", to: "2026-09-24T00:00:00.000Z" });
  });
});
