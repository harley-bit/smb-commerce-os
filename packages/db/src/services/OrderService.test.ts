import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { OrderService } from "./OrderService.js";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

describe("OrderService", () => {
  let connection: Connection;
  let service: OrderService;
  let orders: OrderRepository;
  let merchantA: string;
  let userA: string;
  let productListingId: string;
  let productVariantId: string;
  let serviceListingId: string;
  let serviceVariantId: string;
  let rentalListingId: string;
  let rentalVariantId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orders = new OrderRepository(connection);
    const listings = new ListingRepository(connection);
    service = new OrderService(orders, listings);

    merchantA = generateUuidV7();
    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: CREATED_AT,
    });

    userA = generateUuidV7();
    await connection.db.insert(sqliteSchema.users).values({
      id: userA,
      email: "a@example.com",
      status: "ACTIVE",
      createdAt: CREATED_AT,
    });

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

    rentalListingId = listings.create(ctx, {
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "PUBLISHED",
      createdAt: CREATED_AT,
    });
    rentalVariantId = variants.create(ctx, {
      listingId: rentalListingId,
      mode: "RENTAL",
      sku: "KAYAK-1",
      name: "Single kayak",
      priceMinor: 5000,
      currency: "USD",
      bufferMinutes: 0,
    });
  });

  function seedMixedOrder(ctx: ReturnType<typeof createTenantContext>): string {
    const orderId = orders.create(ctx, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
    orders.addLine(ctx, orderId, {
      listingId: productListingId,
      variantId: productVariantId,
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1200,
      lineTotalMinor: 2400,
    });
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
    orders.addLine(ctx, orderId, {
      listingId: rentalListingId,
      variantId: rentalVariantId,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
      startsAt: "2026-10-02T09:00:00.000Z",
      endsAt: "2026-10-03T09:00:00.000Z",
    });
    orders.updateTotals(ctx, orderId, { subtotalMinor: 11900, taxMinor: 0, totalMinor: 11900 });
    return orderId;
  }

  it("listOrders() reports the set of modes present on each order — PRODUCT, SERVICE, and RENTAL all render", () => {
    const ctx = createTenantContext(merchantA);
    const orderId = seedMixedOrder(ctx);

    const summaries = service.listOrders(ctx, "STAFF");

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: orderId, totalMinor: 11900 });
    expect(new Set(summaries[0]!.modes)).toEqual(new Set(["PRODUCT", "SERVICE", "RENTAL"]));
  });

  it("getOrderDetail() resolves a listing name per line for all three modes", () => {
    const ctx = createTenantContext(merchantA);
    const orderId = seedMixedOrder(ctx);

    const detail = service.getOrderDetail(ctx, "STAFF", orderId);

    expect(detail).toBeDefined();
    expect(detail!.lines).toHaveLength(3);
    const byMode = new Map(detail!.lines.map((line) => [line.mode, line]));
    expect(byMode.get("PRODUCT")).toMatchObject({ listingName: "Mug" });
    expect(byMode.get("SERVICE")).toMatchObject({ listingName: "Haircut" });
    expect(byMode.get("RENTAL")).toMatchObject({ listingName: "Kayak" });
  });

  it("getOrderDetail() returns undefined for an order id that does not exist", () => {
    const ctx = createTenantContext(merchantA);
    expect(service.getOrderDetail(ctx, "STAFF", "does-not-exist")).toBeUndefined();
  });

  it("READ_ONLY can list and view order detail (orders:view is granted to every role)", () => {
    const ctx = createTenantContext(merchantA);
    const orderId = seedMixedOrder(ctx);

    expect(service.listOrders(ctx, "READ_ONLY")).toHaveLength(1);
    expect(service.getOrderDetail(ctx, "READ_ONLY", orderId)).toBeDefined();
  });

  it("is tenant-scoped — merchant B never sees merchant A's orders", () => {
    const ctxA = createTenantContext(merchantA);
    const orderId = seedMixedOrder(ctxA);

    const merchantB = generateUuidV7();
    const ctxB = createTenantContext(merchantB);

    expect(service.listOrders(ctxB, "STAFF")).toEqual([]);
    expect(service.getOrderDetail(ctxB, "STAFF", orderId)).toBeUndefined();
  });
});
