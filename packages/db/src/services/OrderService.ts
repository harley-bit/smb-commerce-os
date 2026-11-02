import { assertCan, type MerchantRole, type TenantContext } from "@smb-os/domain";
import type { ListingRepository } from "../repositories/ListingRepository.js";
import type { Order, OrderLineMode, OrderRepository } from "../repositories/OrderRepository.js";

export interface OrderSummary {
  id: string;
  status: Order["status"];
  currency: string;
  totalMinor: number;
  placedAt: string | null;
  modes: OrderLineMode[];
}

export interface OrderLineDetail {
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

export interface OrderDetail extends OrderSummary {
  subtotalMinor: number;
  taxMinor: number;
  customerUserId: string;
  cancelledAt: string | null;
  lines: OrderLineDetail[];
}

/**
 * `docs/cards/D115.md` — Order list and detail. `order_lines.mode` already
 * carries `PRODUCT`/`SERVICE`/`RENTAL` per line (`docs/design/03`), so a
 * "cross-mode" order here means reading the distinct set of modes across an
 * order's own lines — unlike D114's `CalendarService`, there's no separate
 * table per mode to merge.
 *
 * Read-only: gated by `orders:view`, granted to every merchant role
 * (`packages/domain/src/auth/rbac.ts`) including `READ_ONLY`, the same
 * staff-wide-view rationale as `bookings:view`. This card adds no mutation
 * route, so `READ_ONLY cannot mutate` (this card's security check) holds
 * structurally — there is nothing here to mutate through.
 */
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly listings: ListingRepository,
  ) {}

  listOrders(ctx: TenantContext, role: MerchantRole): OrderSummary[] {
    assertCan({ role }, "orders:view", "order");

    return this.orders.listByMerchant(ctx).map((order) => this.toSummary(ctx, order));
  }

  getOrderDetail(ctx: TenantContext, role: MerchantRole, orderId: string): OrderDetail | undefined {
    assertCan({ role }, "orders:view", "order");

    const order = this.orders.findById(ctx, orderId);
    if (!order) return undefined;

    const lines = this.orders.listLines(ctx, order.id).map((line) => ({
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
    }));

    return {
      ...this.toSummary(ctx, order),
      subtotalMinor: order.subtotalMinor,
      taxMinor: order.taxMinor,
      customerUserId: order.customerUserId,
      cancelledAt: order.cancelledAt,
      lines,
    };
  }

  private toSummary(ctx: TenantContext, order: Order): OrderSummary {
    const modes = [...new Set(this.orders.listLines(ctx, order.id).map((line) => line.mode))];
    return {
      id: order.id,
      status: order.status,
      currency: order.currency,
      totalMinor: order.totalMinor,
      placedAt: order.placedAt,
      modes,
    };
  }
}
