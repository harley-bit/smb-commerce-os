import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import type { FulfillmentEventRepository } from "../repositories/FulfillmentEventRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";

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
 * `docs/cards/D070.md`/`D071.md` — PICKED_UP and RETURNED event handlers on
 * top of `FulfillmentEventRepository`'s append-only ledger. Authorization
 * reuses `bookings:manage`, the same action `RentalReservationService`/
 * `BookingService` already gate on — recording a pickup/return is an
 * operational booking action, not a catalog-management action.
 *
 * `docs/cards/D071.md` — if the order line has a linked reservation
 * (`ReservationRepository.findByOrderLineId`), the matching event also
 * drives that reservation through `ReservationRepository`'s single
 * transition path (`markPickedUp`/`markReturned`, both routed through
 * `applyReservationEvent`) — never by writing `state` directly. The
 * transition runs *before* the event is recorded: an illegal transition
 * (e.g. a RETURNED event with no prior pickup) throws
 * `IllegalReservationTransitionError` and the event is never written, so
 * the append-only log never records an operation that didn't actually
 * happen. Not every order line has a reservation (a product-sale line,
 * for instance) — `findByOrderLineId` returning nothing is not an error,
 * it just means this event has nothing to transition.
 */
export class FulfillmentEventService {
  constructor(
    private readonly orderLines: OrderRepository,
    private readonly events: FulfillmentEventRepository,
    private readonly reservations: ReservationRepository,
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

    const reservation = this.reservations.findByOrderLineId(ctx, input.orderLineId);
    if (reservation) {
      if (kind === "PICKED_UP") {
        this.reservations.markPickedUp(ctx, reservation.id);
      } else {
        this.reservations.markReturned(ctx, reservation.id, input.occurredAt);
      }
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
