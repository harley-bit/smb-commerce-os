/**
 * `docs/design/05` line 111 "Allocation policy" / `docs/cards/D065.md` —
 * rental assets are always serialized (one `inventory_units` row per
 * physical unit), so booking a rental means picking one free unit out of
 * however many satisfy the request. Choosing deterministically by **least
 * recently returned first** spreads wear evenly across the fleet and
 * produces even utilisation data, unlike "lowest ID," which would hammer
 * unit #1. The caller is responsible for narrowing `candidates` down to
 * units that are actually free for the requested interval (status +
 * overlap check) before calling this — this function only decides *which*
 * of an already-free set to hand out.
 */
export interface AllocationCandidate {
  readonly unitId: string;
  /** ISO-8601 timestamp of the unit's last return, or `null` if it has never been used. */
  readonly lastReturnedAt: string | null;
}

export class NoAvailableUnitError extends Error {
  constructor() {
    super("No available unit to allocate: candidate list is empty");
    this.name = "NoAvailableUnitError";
  }
}

/**
 * A unit that has never been returned (`lastReturnedAt === null`) is
 * treated as infinitely long ago — it is always preferred over any unit
 * with a concrete last-returned timestamp. Ties are broken by `unitId`
 * ascending so the result is reproducible under test.
 */
export function selectUnitForAllocation(candidates: readonly AllocationCandidate[]): AllocationCandidate {
  if (candidates.length === 0) {
    throw new NoAvailableUnitError();
  }

  const sorted = [...candidates].sort((a, b) => {
    const aTime = a.lastReturnedAt === null ? -Infinity : Date.parse(a.lastReturnedAt);
    const bTime = b.lastReturnedAt === null ? -Infinity : Date.parse(b.lastReturnedAt);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0;
  });
  const [selected] = sorted;
  if (!selected) {
    throw new NoAvailableUnitError();
  }
  return selected;
}
