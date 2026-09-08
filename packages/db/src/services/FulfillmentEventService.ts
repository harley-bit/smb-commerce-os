import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { FulfillmentEventRepository } from "../repositories/FulfillmentEventRepository.js";

export interface RecordFulfillmentEventArgs {
  orderLineId: string;
  occurredAt: string;
  actorUserId: string;
  note: string;
}

/** Thrown when `orderLineId` doesn't resolve to a line owned by the caller's merchant. */
export class OrderLineNotFoundError extends Error {
  constructor(public readonly orderLineId: string) {
    super(`Order line not found: ${orderLineId}`);
    this.name = "OrderLineNotFoundError";
  }
}

/**
 * `docs/cards/D070.md` security check — the event log is repudiation
 * defence, so an event with no substantive note is worthless as evidence.
 */
export class MissingFulfillmentNoteError extends Error {
  constructor() {
    super("A non-empty note is required to record a fulfillment event");
    this.name = "MissingFulfillmentNoteError";
  }
}

/**
 * `docs/cards/D070.md` — PICKED_UP and RETURNED event handlers on top of
 * `FulfillmentEventRepository`'s append-only ledger. Authorization reuses
 * `bookings:manage`, the same action `RentalReservationService`/`BookingService`
 * already gate on — recording a pickup/return is an operational booking
 * action, not a catalog-management one.
 *
 * Deliberately narrow scope: this card only records the events. It does not
 * transition the underlying reservation's state (`docs/cards/D071.md`,
 * "Event-driven state transitions", is the next card and owns that).
 */
export class FulfillmentEventService {
  constructor(
    private readonly orderLines: OrderRepository,
    private readonly events: FulfillmentEventRepository,
  ) {}

  recordPickup(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RecordFulfillmentEventArgs,
  ): string {
    return this.recordEvent(ctx, actingRole, "PICKED_UP", input);
  }

  recordReturn(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RecordFulfillmentEventArgs,
  ): string {
    return this.recordEvent(ctx, actingRole, "RETURNED", input);
  }

  private recordEvent(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    kind: "PICKED_UP" | "RETURNED",
    input: RecordFulfillmentEventArgs,
  ): string {
    assertCan({ role: actingRole }, "bookings:manage");

    if (input.note.trim().length === 0) {
      throw new MissingFulfillmentNoteError();
    }

    const line = this.orderLines.findLineById(ctx, input.orderLineId);
    if (!line) {
      throw new OrderLineNotFoundError(input.orderLineId);
    }

    return this.events.record(ctx, {
      orderLineId: input.orderLineId,
      kind,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
      note: input.note,
    });
  }
}
