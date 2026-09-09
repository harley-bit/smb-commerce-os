import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { CustomerOrderHistoryService } from "./CustomerOrderHistoryService.js";

const CREATED_AT = "2026-09-08T00:00:00.000Z";
const NOW = "2026-09-09T00:00:00.000Z";

describe("CustomerOrderHistoryService", () => {
  let connection: Connection;
  let service: CustomerOrderHistoryService;
  let orders: OrderRepository;
  let merchantA: string;
  let customerA: string;
  let customerB: string;
  let productListingId: string;
  let productVariantId: string;
  let serviceListingId: string;
  let serviceVariantId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orders = new OrderRepository(connection);
    const listings = new ListingRepository(connection);
    service = new CustomerOrderHistoryService(orders, listings);

    merchantA = generateUuidV7();
    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: CREATED_AT,
    });

    customerA = generateUuidV7();
    customerB = generateUuidV7();
    await connection.db.insert(sqliteSchema.users).values([
      { id: customerA, email: "a@example.com", status: "ACTIVE", createdAt: CREATED_AT },
      { id: customerB, email: "b@example.com", status: "ACTIVE", createdAt: CREATED_AT },
    ]);

    const ctx = createTenantContext(merchantA);
    const variants = new VariantRepository(connection);

    productListingId = listings.create(ctx, {
      mode: "PRODUCT",
      name: "Mug",
      slug: "mug",
      status: "PUBLISHED",
      createdAt: CREATED_AT,
    });
    productVariantId = variants.create(ctx, {
      listingId: productListingId,
      mode: "PRODUCT",
      sku: "MUG-1",
      name: "Mug",
      priceMinor: 1200,
      currency: "USD",
    });

    serviceListingId = listings.create(ctx, {
      mode: "SERVICE",
      name: "Haircut",
      slug: "haircut",
      status: "PUBLISHED",
      createdAt: CREATED_AT,
    });
    serviceVariantId = variants.create(ctx, {
      listingId: serviceListingId,
      mode: "SERVICE",
      sku: "CUT-1",
      name: "Haircut",
      priceMinor: 4500,
      currency: "USD",
      durationMinutes: 30,
    });
  });

  function seedProductOnlyOrder(ctx: ReturnType<typeof createTenantContext>, customerUserId: string): string {
    const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    orders.addLine(ctx, orderId, {
      listingId: productListingId,
      variantId: productVariantId,
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1200,
      lineTotalMinor: 2400,
    });
    orders.updateTotals(ctx, orderId, { subtotalMinor: 2400, taxMinor: 0, totalMinor: 2400 });
    return orderId;
  }

  function seedFutureServiceOrder(ctx: ReturnType<typeof createTenantContext>, customerUserId: string): string {
    const orderId = orders.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    orders.addLine(ctx, orderId, {
      listingId: serviceListingId,
      variantId: serviceVariantId,
      mode: "SERVICE",
      quantity: 1,
      unitPriceMinor: 4500,
      lineTotalMinor: 4500,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T09:30:00.000Z",
    });
    orders.updateTotals(ctx, orderId, { subtotalMinor: 4500, taxMinor: 0, totalMinor: 4500 });
    return orderId;
  }

  it("listOrderHistory() buckets a product-only order as past and a future service order as upcoming", () => {
    const ctx = createTenantContext(merchantA);
    const pastOrderId = seedProductOnlyOrder(ctx, customerA);
    const upcomingOrderId = seedFutureServiceOrder(ctx, customerA);

    const history = service.listOrderHistory(ctx, customerA, NOW);

    expect(history.past.map((o) => o.id)).toEqual([pastOrderId]);
    expect(history.upcoming.map((o) => o.id)).toEqual([upcomingOrderId]);
  });

  it("listOrderHistory() never returns another customer's orders", () => {
    const ctx = createTenantContext(merchantA);
    seedProductOnlyOrder(ctx, customerA);

    const history = service.listOrderHistory(ctx, customerB, NOW);

    expect(history.past).toEqual([]);
    expect(history.upcoming).toEqual([]);
  });

  it("getOrderDetail() returns the order's lines for the owning customer", () => {
    const ctx = createTenantContext(merchantA);
    const orderId = seedFutureServiceOrder(ctx, customerA);

    const detail = service.getOrderDetail(ctx, customerA, orderId);

    expect(detail).toBeDefined();
    expect(detail!.lines).toHaveLength(1);
    expect(detail!.lines[0]).toMatchObject({ mode: "SERVICE", listingName: "Haircut" });
  });

  it("this card's security check — IDOR: getOrderDetail() returns undefined for another customer's order id", () => {
    const ctx = createTenantContext(merchantA);
    const orderId = seedFutureServiceOrder(ctx, customerA);

    expect(service.getOrderDetail(ctx, customerB, orderId)).toBeUndefined();
  });

  it("getOrderDetail() returns undefined for an order id that does not exist at all — same outcome as another customer's order", () => {
    const ctx = createTenantContext(merchantA);
    expect(service.getOrderDetail(ctx, customerA, "does-not-exist")).toBeUndefined();
  });

  it("is tenant-scoped — merchant B never sees merchant A's customer orders", () => {
    const ctxA = createTenantContext(merchantA);
    const orderId = seedProductOnlyOrder(ctxA, customerA);

    const merchantB = generateUuidV7();
    const ctxB = createTenantContext(merchantB);

    expect(service.listOrderHistory(ctxB, customerA, NOW)).toEqual({ upcoming: [], past: [] });
    expect(service.getOrderDetail(ctxB, customerA, orderId)).toBeUndefined();
  });
});
