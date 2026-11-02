import { assertCan, type MerchantRole, type TenantContext } from "@smb-os/domain";
import type { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import type { Reservation, ReservationRepository } from "../repositories/ReservationRepository.js";
import type { ResourceRepository } from "../repositories/ResourceRepository.js";

export interface CalendarEntry {
  id: string;
  subjectType: Reservation["subjectType"];
  subjectId: string;
  subjectLabel: string;
  startsAt: string;
  endsAt: string;
  state: Reservation["state"];
  orderLineId: string | null;
  hasConflict: boolean;
  /** `docs/cards/D127.md` — feeds the calendar's visible hold countdown; `null` for anything not currently `HELD`. */
  expiresAt: string | null;
}

/**
 * `docs/design/05`'s `blockingStatePredicate` states, mirrored here so the
 * conflict check flags the same rows that would have caused a real
 * `ReservationConflictError` at write time (`HELD`/`CONFIRMED`/`IN_USE`) —
 * `COMPLETED`/`CANCELLED`/`EXPIRED` rows never block, so two of those
 * overlapping in time is not a conflict, just history.
 */
const CONFLICTING_STATES: ReadonlySet<Reservation["state"]> = new Set(["HELD", "CONFIRMED", "IN_USE"]);

function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * `docs/cards/D114.md` — Unified calendar. Merges service `RESOURCE`
 * bookings and rental `INVENTORY_UNIT` reservations (both already live in
 * `ReservationRepository`'s one `reservations` table, distinguished only by
 * `subjectType`) into a single filterable read model.
 *
 * Conflicts: `ReservationRepository.createGuarded` already makes a genuine
 * double-booking impossible on the write path (Gate G3) — this service's
 * conflict flag exists as a defensive read-side check, so any inconsistent
 * data (e.g. a future direct-SQL fix, a bug, a migration) is surfaced to
 * staff rather than silently rendered as if nothing were wrong.
 *
 * Security check (this card): a calendar entry never carries
 * `createdByIp`/`createdByAccountId` — a raw IP address is not something
 * staff need to run the calendar, and the actor's account id is available,
 * if actually needed, by opening the reservation/order directly rather than
 * appearing on every row of a shared operational view.
 */
export class CalendarService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly resources: ResourceRepository,
    private readonly inventoryUnits: InventoryUnitRepository,
  ) {}

  getCalendar(ctx: TenantContext, role: MerchantRole, rangeStart: string, rangeEnd: string): CalendarEntry[] {
    assertCan({ role }, "bookings:view", "calendar");

    const rows = this.reservations.listInRange(ctx, rangeStart, rangeEnd);
    const conflictIds = this.findConflictIds(rows);

    return rows.map((row) => ({
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectLabel: this.resolveLabel(ctx, row),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      state: row.state,
      orderLineId: row.orderLineId,
      hasConflict: conflictIds.has(row.id),
      expiresAt: row.expiresAt,
    }));
  }

  private findConflictIds(rows: Reservation[]): Set<string> {
    const conflictIds = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i]!;
      if (!CONFLICTING_STATES.has(a.state)) continue;
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j]!;
        if (
          a.subjectType === b.subjectType &&
          a.subjectId === b.subjectId &&
          CONFLICTING_STATES.has(b.state) &&
          intervalsOverlap(a.startsAt, a.endsAt, b.startsAt, b.endsAt)
        ) {
          conflictIds.add(a.id);
          conflictIds.add(b.id);
        }
      }
    }
    return conflictIds;
  }

  private resolveLabel(ctx: TenantContext, row: Reservation): string {
    if (row.subjectType === "RESOURCE") {
      return this.resources.findById(ctx, row.subjectId)?.name ?? "Unknown resource";
    }
    return this.inventoryUnits.findById(ctx, row.subjectId)?.unitCode ?? "Unknown unit";
  }
}
