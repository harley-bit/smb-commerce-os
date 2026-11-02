import { classifyOrderTiming, type TenantContext } from "@smb-os/domain";
import type { ListingRepository } from "../repositories/ListingRepository.js";
import type { Order, OrderLine, OrderLineMode, OrderRepository } from "../repositories/OrderRepository.js";

export interface CustomerOrderSummary {
  id: string;
  status: Order["status"];
  currency: string;
  totalMinor: number;
  placedAt: string | null;
  modes: OrderLineMode[];
}

export interface CustomerOrderLineDetail {
  id: string;
  listingId: string;
  listingName: string;
  variantId: string;
  mode: OrderLineMode;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  depositMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface CustomerOrderDetail extends CustomerOrderSummary {
  subtotalMinor: number;
  taxMinor: number;
  lines: CustomerOrderLineDetail[];
}

export interface CustomerOrderHistory {
  upcoming: CustomerOrderSummary[];
  past: CustomerOrderSummary[];
}

/**
 * `docs/cards/D132.md` — "Order history". Every read here is scoped both by
 * `TenantContext` (per `OrderRepository`'s own scoping) *and* by
 * `customerUserId` — this card's acceptance criterion ("only the
 * authenticated customer's orders are returned") — `listOrderHistory` reads
 * exclusively via `OrderRepository.listByCustomer`, which filters by
 * `customerUserId` in the query itself, never by fetching everyone's orders
 * and filtering client-side.
 *
 * `getOrderDetail` re-checks `order.customerUserId` even though the order
 * was already found by id, and returns `undefined` — the exact same outcome
 * as an order id that doesn't exist at all — whenever it belongs to a
 * different customer. This card's security check (IDOR: another customer's
 * order id returns 404): the caller (`apps/api`'s route) maps `undefined`
 * to a flat 404 in both cases, so there is no way to distinguish "this
 * order doesn't exist" from "this order isn't yours" from the outside.
 *
 * "Past and upcoming across modes" (this card's deliverable) is computed
 * per order via `@smb-os/domain`'s `classifyOrderTiming`, itself driven
 * entirely by each line's own recorded `startsAt`/`endsAt` — never by order
 * status — so a PRODUCT-only order buckets as past once placed, while a
 * SERVICE/RENTAL order with a date still ahead buckets as upcoming.
 */
export class CustomerOrderHistoryService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly listings: ListingRepository,
  ) {}

  listOrderHistory(ctx: TenantContext, customerUserId: string, now: string): CustomerOrderHistory {
    const history: CustomerOrderHistory = { upcoming: [], past: [] };

    for (const order of this.orders.listByCustomer(ctx, customerUserId)) {
      const lines = this.orders.listLines(ctx, order.id);
      const summary = this.toSummary(order, lines);
      const bucket = classifyOrderTiming(lines, now);
      history[bucket === "UPCOMING" ? "upcoming" : "past"].push(summary);
    }

    return history;
  }

  getOrderDetail(ctx: TenantContext, customerUserId: string, orderId: string): CustomerOrderDetail | undefined {
    const order = this.orders.findById(ctx, orderId);
    if (!order || order.customerUserId !== customerUserId) {
      return undefined;
    }

    const lines = this.orders.listLines(ctx, order.id);

    return {
      ...this.toSummary(order, lines),
      subtotalMinor: order.subtotalMinor,
      taxMinor: order.taxMinor,
      lines: lines.map((line) => ({
        id: line.id,
        listingId: line.listingId,
        listingName: this.listings.findById(ctx, line.listingId)?.name ?? "Unknown listing",
        variantId: line.variantId,
        mode: line.mode,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        depositMinor: line.depositMinor,
        startsAt: line.startsAt,
        endsAt: line.endsAt,
      })),
    };
  }

  private toSummary(order: Order, lines: OrderLine[]): CustomerOrderSummary {
    return {
      id: order.id,
      status: order.status,
      currency: order.currency,
      totalMinor: order.totalMinor,
      placedAt: order.placedAt,
      modes: [...new Set(lines.map((line) => line.mode))],
    };
  }
}
