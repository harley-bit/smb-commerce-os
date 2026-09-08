import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { orders, orderLines } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type OrderStatus =
  | "CART"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUNDED";

export type OrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

export interface Order {
  id: string;
  merchantId: string;
  customerUserId: string;
  status: OrderStatus;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  placedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateOrderInput {
  customerUserId: string;
  status: OrderStatus;
  currency: string;
}

export interface OrderLine {
  id: string;
  merchantId: string;
  orderId: string;
  listingId: string;
  variantId: string;
  mode: OrderLineMode;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  depositMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface AddOrderLineInput {
  listingId: string;
  variantId: string;
  mode: OrderLineMode;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  depositMinor?: number;
  startsAt?: string;
  endsAt?: string;
}

export interface OrderTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * `orders`/`order_lines.merchant_id` scope every query, per `docs/design/07`
 * Control #1. `updateTotals` is the only writer of the totals columns — the
 * card's acceptance criterion (totals recomputed server-side on every
 * mutation) is enforced by the caller (`../services/CartService.ts`) always
 * recomputing from `listLines` and calling this on every line mutation, not
 * by anything in this repository itself; `addLine` never touches the
 * totals columns.
 */
export class OrderRepository extends TenantScopedRepository<typeof orders.merchantId> {
  constructor(private readonly conn: Connection) {
    super(orders.merchantId);
  }

  create: RepositoryMethod<[input: CreateOrderInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(orders)
      .values({
        id,
        merchantId: ctx.merchantId,
        customerUserId: input.customerUserId,
        status: input.status,
        currency: input.currency,
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      })
      .run();
    return id;
  };

  findById: RepositoryMethod<[id: string], Order | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(orders)
      .where(and(this.scope(ctx), eq(orders.id, id)))
      .get() as Order | undefined;
  };

  addLine: RepositoryMethod<[orderId: string, input: AddOrderLineInput], string> = (ctx, orderId, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(orderLines)
      .values({ id, merchantId: ctx.merchantId, orderId, ...input })
      .run();
    return id;
  };

  listLines: RepositoryMethod<[orderId: string], OrderLine[]> = (ctx, orderId) => {
    return this.conn.db
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.merchantId, ctx.merchantId), eq(orderLines.orderId, orderId)))
      .all() as OrderLine[];
  };

  updateTotals: RepositoryMethod<[orderId: string, totals: OrderTotals], void> = (ctx, orderId, totals) => {
    this.conn.db
      .update(orders)
      .set(totals)
      .where(and(this.scope(ctx), eq(orders.id, orderId)))
      .run();
  };
}
