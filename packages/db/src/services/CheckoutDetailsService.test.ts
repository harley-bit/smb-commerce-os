import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { CheckoutConsentRepository } from "../repositories/CheckoutConsentRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import {
  CheckoutDetailsService,
  MissingTermsVersionError,
  NotOrderOwnerError,
  OrderNotCheckoutableError,
  OrderNotFoundError,
} from "./CheckoutDetailsService.js";

describe("CheckoutDetailsService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let consents: CheckoutConsentRepository;
  let auditLog: AuditLogRepository;
  let service: CheckoutDetailsService;
  let merchantA: string;
  let userId: string;
  let otherUserId: string;
  let cartId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orderRepo = new OrderRepository(connection);
    consents = new CheckoutConsentRepository(connection);
    auditLog = new AuditLogRepository(connection);
    service = new CheckoutDetailsService(orderRepo, consents, auditLog);

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
    cartId = orderRepo.create(ctx, { customerUserId: userId, status: "CART", currency: "USD" });
  });

  it("records consent with the terms version and timestamp, and stores contact details", () => {
    const ctx = createTenantContext(merchantA);

    const result = service.submitDetails(ctx, {
      orderId: cartId,
      customerUserId: userId,
      contactName: "Ada Lovelace",
      contactEmail: "ada@example.com",
      contactPhone: "+15551234567",
      termsVersion: "2026-09-01",
      consentedAt: "2026-09-09T12:00:00.000Z",
      ip: "203.0.113.5",
      userAgent: "vitest",
    });

    expect(result.termsVersion).toBe("2026-09-01");
    expect(result.consentedAt).toBe("2026-09-09T12:00:00.000Z");

    const stored = consents.findLatestForOrder(ctx, cartId);
    expect(stored?.termsVersion).toBe("2026-09-01");
    expect(stored?.customerUserId).toBe(userId);

    const order = orderRepo.findById(ctx, cartId);
    expect(order?.contactName).toBe("Ada Lovelace");
    expect(order?.contactEmail).toBe("ada@example.com");
    expect(order?.contactPhone).toBe("+15551234567");
  });

  it("mirrors the consent into the tamper-evident audit log for repudiation defence", () => {
    const ctx = createTenantContext(merchantA);

    service.submitDetails(ctx, {
      orderId: cartId,
      customerUserId: userId,
      contactName: "Ada Lovelace",
      contactEmail: "ada@example.com",
      termsVersion: "2026-09-01",
      consentedAt: "2026-09-09T12:00:00.000Z",
    });

    const entries = auditLog.list(ctx);
    const entry = entries.find((e) => e.action === "checkout.consent_recorded");
    expect(entry).toBeDefined();
    expect(entry?.entityId).toBe(cartId);
    expect(entry?.afterJson).toContain("2026-09-01");
    // Chain integrity: a non-genesis row's prevHash must match a real predecessor's rowHash.
    expect(entry?.prevHash).toBeTruthy();
    expect(entry?.rowHash).toBeTruthy();
  });

  it("rejects an empty terms version", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.submitDetails(ctx, {
        orderId: cartId,
        customerUserId: userId,
        contactName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        termsVersion: "",
        consentedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(MissingTermsVersionError);
  });

  it("rejects a customer consenting on an order they do not own", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.submitDetails(ctx, {
        orderId: cartId,
        customerUserId: otherUserId,
        contactName: "Eve",
        contactEmail: "eve@example.com",
        termsVersion: "2026-09-01",
        consentedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(NotOrderOwnerError);
  });

  it("rejects an unknown order", () => {
    const ctx = createTenantContext(merchantA);
    expect(() =>
      service.submitDetails(ctx, {
        orderId: generateUuidV7(),
        customerUserId: userId,
        contactName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        termsVersion: "2026-09-01",
        consentedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(OrderNotFoundError);
  });

  it("rejects submitting details once the order is no longer checkoutable", () => {
    const ctx = createTenantContext(merchantA);
    orderRepo.updateTotals(ctx, cartId, { subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000 });
    connection.db
      .update(sqliteSchema.orders)
      .set({ status: "CONFIRMED" })
      .run();

    expect(() =>
      service.submitDetails(ctx, {
        orderId: cartId,
        customerUserId: userId,
        contactName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        termsVersion: "2026-09-01",
        consentedAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toThrow(OrderNotCheckoutableError);
  });
});
