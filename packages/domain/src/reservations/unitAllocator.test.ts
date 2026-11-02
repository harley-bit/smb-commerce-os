import { describe, expect, it } from "vitest";
import { NoAvailableUnitError, selectUnitForAllocation, type AllocationCandidate } from "./unitAllocator.js";

/**
 * `docs/design/05` line 111 "Allocation policy" / `docs/cards/D065.md` —
 * when several free units could satisfy a rental request, choose
 * deterministically: least recently returned first. This spreads wear
 * evenly across the fleet instead of hammering the lowest-ID unit.
 */
describe("selectUnitForAllocation", () => {
  it("selects the unit whose lastReturnedAt is the oldest (least recently returned)", () => {
    const candidates: AllocationCandidate[] = [
      { unitId: "unit-b", lastReturnedAt: "2026-09-01T00:00:00.000Z" },
      { unitId: "unit-a", lastReturnedAt: "2026-08-01T00:00:00.000Z" },
      { unitId: "unit-c", lastReturnedAt: "2026-09-15T00:00:00.000Z" },
    ];
    expect(selectUnitForAllocation(candidates).unitId).toBe("unit-a");
  });

  it("prefers a never-used unit (lastReturnedAt = null) over any unit that has been returned", () => {
    const candidates: AllocationCandidate[] = [
      { unitId: "unit-used", lastReturnedAt: "2020-01-01T00:00:00.000Z" },
      { unitId: "unit-fresh", lastReturnedAt: null },
    ];
    expect(selectUnitForAllocation(candidates).unitId).toBe("unit-fresh");
  });

  it("breaks ties deterministically by unitId ascending when lastReturnedAt is equal", () => {
    const candidates: AllocationCandidate[] = [
      { unitId: "unit-z", lastReturnedAt: null },
      { unitId: "unit-a", lastReturnedAt: null },
      { unitId: "unit-m", lastReturnedAt: null },
    ];
    expect(selectUnitForAllocation(candidates).unitId).toBe("unit-a");
  });

  it("is deterministic: repeated calls with the same input return the same unit", () => {
    const candidates: AllocationCandidate[] = [
      { unitId: "unit-b", lastReturnedAt: "2026-09-01T00:00:00.000Z" },
      { unitId: "unit-a", lastReturnedAt: "2026-08-01T00:00:00.000Z" },
    ];
    const first = selectUnitForAllocation(candidates);
    const second = selectUnitForAllocation(candidates);
    expect(first).toEqual(second);
  });

  it("throws NoAvailableUnitError when there are no candidates", () => {
    expect(() => selectUnitForAllocation([])).toThrow(NoAvailableUnitError);
  });

  it("spreads allocation evenly across the fleet over successive rental cycles", () => {
    let fleet: AllocationCandidate[] = [
      { unitId: "unit-1", lastReturnedAt: null },
      { unitId: "unit-2", lastReturnedAt: null },
      { unitId: "unit-3", lastReturnedAt: null },
    ];
    const allocationOrder: string[] = [];

    // Simulate 6 rental cycles (two full passes over a 3-unit fleet): each
    // cycle allocates a unit, then immediately "returns" it with a fresh
    // timestamp so the next allocation must pick a different unit.
    for (let cycle = 0; cycle < 6; cycle++) {
      const chosen = selectUnitForAllocation(fleet);
      allocationOrder.push(chosen.unitId);
      const returnedAt = new Date(2026, 0, cycle + 1).toISOString();
      fleet = fleet.map((unit) => (unit.unitId === chosen.unitId ? { ...unit, lastReturnedAt: returnedAt } : unit));
    }

    // Every unit must be used before any unit is reused (first pass), and
    // the exact same round-robin order repeats on the second pass since
    // return timestamps are strictly increasing.
    expect(allocationOrder).toEqual(["unit-1", "unit-2", "unit-3", "unit-1", "unit-2", "unit-3"]);
    expect(new Set(allocationOrder.slice(0, 3))).toEqual(new Set(["unit-1", "unit-2", "unit-3"]));
  });
});
