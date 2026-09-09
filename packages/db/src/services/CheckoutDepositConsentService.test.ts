import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { DepositConsentRepository } from "../repositories/DepositConsentRepository.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import {
  CheckoutDepositConsentService,
  NotOrderOwnerError,
  OrderLineNotFoundError,
  OrderNotCheckoutableError,
  OrderNotFoundError,
} from "./CheckoutDepositConsentService.js";

describe("CheckoutDepositConsentService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let consents: DepositConsentRepository;
  let auditLog: AuditLogRepository;
  let service: CheckoutDepositConsentService;
  let merchantA: string;
  let userId: string;
  let otherUserId: string;
  let orderId: string;
  let rentalOrderLineId: string;
  let productOrderLineId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    consents = new DepositConsentRepository(connection);
    auditLog = new AuditLogRepository(connection);
    service = new CheckoutDepositConsentService(orderRepo, consents, auditLog);

    merchantA = generateUuidV7();
    userId = generateUuidV7();
    otherUserId = generateUuidV7();

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
      { id: otherUserId, email: "other@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    orderId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });

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
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
    });
    rentalOrderLineId = orderRepo.addLine(ctx, orderId, {
      listingId: rentalListing,
      variantId: rentalVariant,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
      depositMinor: 20000,
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-13T00:00:00.000Z",
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
    productOrderLineId = orderRepo.addLine(ctx, orderId, {
      listingId: productListing,
      variantId: productVariant,
      mode: "PRODUCT",
      quantity: 1,
      unitPriceMinor: 1000,
      lineTotalMinor: 1000,
    });
  });

  it("discloses hold amount, duration, and conditions, and records consent", () => {
    const ctx = createTenantContext(merchantA);

    const result = service.acknowledgeDeposit(ctx, {
      orderId,
      orderLineId: rentalOrderLineId,
      customerUserId: userId,
      acknowledgedAt: "2026-09-09T12:00:00.000Z",
      ip: "203.0.113.5",
      userAgent: "vitest",
    });

    expect(result.holdAmountMinor).toBe(20000);
    expect(result.currency).toBe("USD");
    expect(result.holdDurationDays).toBe(3);
    expect(result.conditions.length).toBeGreaterThan(0);

    const stored = consents.findLatestForOrderLine(ctx, rentalOrderLineId);
    expect(stored?.holdAmountMinor).toBe(20000);
    expect(stored?.holdDurationDays).toBe(3);
    expect(stored?.customerUserId).toBe(userId);
  });

  it("mirrors the consent into the tamper-evident audit log for repudiation defence", () => {
    const ctx = createTenantContext(merchantA);

    service.acknowledgeDeposit(ctx, {
      orderId,
      orderLineId: rentalOrderLineId,
      customerUserId: userId,
      acknowledgedAt: "2026-09-09T12:00:00.000Z",
    });

    const entries = auditLog.list(ctx);
    const entry = entries.find((e) => e.action === "checkout.deposit_consent_recorded");
    expect(entry).toBeDefined();
    expect(entry?.entityId).toBe(rentalOrderLineId);
    expect(entry?.afterJson).toContain("20000");
    expect(entry?.prevHash).toBeTruthy();
    expect(entry?.rowHash).toBeTruthy();
  });

  it("never trusts a client-supplied hold amount — always recomputes from the order line", () => {
    const ctx = createTenantContext(merchantA);

    // Simulates a tampered request body over HTTP, where TypeScript's structural
    // typing at the service boundary would not catch extra fields.
    const tamperedInput = {
      orderId,
      orderLineId: rentalOrderLineId,
      customerUserId: userId,
      acknowledgedAt: "2026-09-09T12:00:00.000Z",
      holdAmountMinor: 1,
      holdDurationDays: 999,
    };

    const result = service.acknowledgeDeposit(ctx, tamperedInput);

    expect(result.holdAmountMinor).toBe(20000);
    expect(result.holdDurationDays).toBe(3);
  });

  it("rejects a customer acknowledging on an order they do not own", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.acknowledgeDeposit(ctx, {
        orderId,
        orderLineId: rentalOrderLineId,
        customerUserId: otherUserId,
        acknowledgedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(NotOrderOwnerError);
  });

  it("rejects an unknown order", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.acknowledgeDeposit(ctx, {
        orderId: generateUuidV7(),
        orderLineId: rentalOrderLineId,
        customerUserId: userId,
        acknowledgedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(OrderNotFoundError);
  });

  it("rejects acknowledging once the order is no longer checkoutable", () => {
    const ctx = createTenantContext(merchantA);
    orderRepo.updateTotals(ctx, orderId, { subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000 });
    connection.db.update(sqliteSchema.orders).set({ status: "CONFIRMED" }).run();

    expect(() =>
      service.acknowledgeDeposit(ctx, {
        orderId,
        orderLineId: rentalOrderLineId,
        customerUserId: userId,
        acknowledgedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(OrderNotCheckoutableError);
  });

  it("rejects an order line that belongs to a different order", () => {
    const ctx = createTenantContext(merchantA);
    const otherOrderId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });

    expect(() =>
      service.acknowledgeDeposit(ctx, {
        orderId: otherOrderId,
        orderLineId: rentalOrderLineId,
        customerUserId: userId,
        acknowledgedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(OrderLineNotFoundError);
  });

  it("rejects a PRODUCT line with no deposit to disclose", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.acknowledgeDeposit(ctx, {
        orderId,
        orderLineId: productOrderLineId,
        customerUserId: userId,
        acknowledgedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow();
  });
});
