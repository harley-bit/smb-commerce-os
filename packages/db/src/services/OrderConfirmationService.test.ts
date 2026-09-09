import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { OrderConfirmationService, OrderNotFoundError } from "./OrderConfirmationService.js";

describe("OrderConfirmationService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let service: OrderConfirmationService;
  let notify: ReturnType<typeof vi.fn>;
  let notifyPush: ReturnType<typeof vi.fn>;
  let merchantA: string;
  let userId: string;
  let orderId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    notify = vi.fn();
    notifyPush = vi.fn();
    service = new OrderConfirmationService(orderRepo, notify, notifyPush);

    merchantA = generateUuidV7();
    userId = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userId, email: "customer@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });
    orderRepo.updateContactDetails(ctx, orderId, {
      contactName: "Jamie Customer",
      contactEmail: "jamie@example.com",
    });

    const productListing = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "A Product Listing",
      slug: "a-product-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    const productVariant = variantRepo.create(ctx, {
      listingId: productListing,
      mode: "PRODUCT",
      sku: "P-SKU",
      name: "A Product Variant",
      priceMinor: 1000,
      currency: "USD",
    });
    orderRepo.addLine(ctx, orderId, {
      listingId: productListing,
      variantId: productVariant,
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1000,
      lineTotalMinor: 2000,
    });

    const rentalListing = listingRepo.create(ctx, {
      mode: "RENTAL",
      name: "A Rental Listing",
      slug: "a-rental-listing",
      status: "PUBLISHED",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    const rentalVariant = variantRepo.create(ctx, {
      listingId: rentalListing,
      mode: "RENTAL",
      sku: "R-SKU",
      name: "A Rental Variant",
      priceMinor: 4000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
    });
    orderRepo.addLine(ctx, orderId, {
      listingId: rentalListing,
      variantId: rentalVariant,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 4000,
      lineTotalMinor: 4000,
      depositMinor: 20000,
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-13T00:00:00.000Z",
    });

    orderRepo.updateTotals(ctx, orderId, { subtotalMinor: 6000, taxMinor: 0, totalMinor: 6000 });
  });

  it("this card's acceptance criterion: itemizes every charge and the deposit hold", () => {
    const ctx = createTenantContext(merchantA);

    const receipt = service.confirmOrder(ctx, { orderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(receipt.orderId).toBe(orderId);
    expect(receipt.totalMinor).toBe(6000);
    expect(receipt.lineItems).toHaveLength(2);
    expect(receipt.lineItems.find((l) => l.mode === "PRODUCT")?.lineTotalMinor).toBe(2000);
    const rentalLine = receipt.lineItems.find((l) => l.mode === "RENTAL");
    expect(rentalLine?.depositHoldMinor).toBe(20000);
    expect(receipt.depositHoldsTotalMinor).toBe(20000);
  });

  it("this card's deliverable: emails the receipt to the order's contact email", () => {
    const ctx = createTenantContext(merchantA);

    service.confirmOrder(ctx, { orderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(notify).toHaveBeenCalledTimes(1);
    const [call] = notify.mock.calls[0] as [{ contactEmail: string; receipt: { orderId: string } }];
    expect(call.contactEmail).toBe("jamie@example.com");
    expect(call.receipt.orderId).toBe(orderId);
  });

  it("this card's deliverable (D148): fires the push notifier for the order's own customer, unconditionally", () => {
    const ctx = createTenantContext(merchantA);

    service.confirmOrder(ctx, { orderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(notifyPush).toHaveBeenCalledTimes(1);
    const [call] = notifyPush.mock.calls[0] as [{ orderId: string; customerUserId: string }];
    expect(call.orderId).toBe(orderId);
    expect(call.customerUserId).toBe(userId);
  });

  it("still fires the push notifier even when the order has no contact email on file", () => {
    const ctx = createTenantContext(merchantA);
    const bareOrderId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });

    service.confirmOrder(ctx, { orderId: bareOrderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(notifyPush).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the order has no contact email on file yet", () => {
    const ctx = createTenantContext(merchantA);
    const bareOrderId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });

    service.confirmOrder(ctx, { orderId: bareOrderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(notify).not.toHaveBeenCalled();
  });

  it("this card's security check: the receipt never carries card data — no such field exists on the type", () => {
    const ctx = createTenantContext(merchantA);

    const receipt = service.confirmOrder(ctx, { orderId, confirmedAt: "2026-09-09T13:00:00.000Z" });

    expect(JSON.stringify(receipt)).not.toMatch(/card|cvc|pan|expiry/i);
  });

  it("rejects an unknown order", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.confirmOrder(ctx, { orderId: generateUuidV7(), confirmedAt: "2026-09-09T13:00:00.000Z" }),
    ).toThrow(OrderNotFoundError);
  });

  it("never leaks another merchant's order", () => {
    const merchantB = generateUuidV7();
    connection.db
      .insert(sqliteSchema.merchants)
      .values({
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      })
      .run();
    const ctxB = createTenantContext(merchantB);

    expect(() => service.confirmOrder(ctxB, { orderId, confirmedAt: "2026-09-09T13:00:00.000Z" })).toThrow(
      OrderNotFoundError,
    );
  });
});
