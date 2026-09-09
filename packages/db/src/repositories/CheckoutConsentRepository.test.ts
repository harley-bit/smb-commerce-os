import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { OrderRepository } from "./OrderRepository.js";
import { CheckoutConsentRepository } from "./CheckoutConsentRepository.js";

describe("CheckoutConsentRepository", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let repo: CheckoutConsentRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let userB: string;
  let orderA: string;
  let orderB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    orderRepo = new OrderRepository(connection);
    repo = new CheckoutConsentRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    userA = generateUuidV7();
    userB = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userA, email: "a@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
      { id: userB, email: "b@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);

    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CART", currency: "USD" });
    orderB = orderRepo.create(ctxB, { customerUserId: userB, status: "CART", currency: "USD" });
  });

  it("record and findLatestForOrder are isolated per tenant", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.record(ctxA, {
      orderId: orderA,
      customerUserId: userA,
      termsVersion: "2026-09-01",
      consentedAt: "2026-09-09T10:00:00.000Z",
    });
    repo.record(ctxB, {
      orderId: orderB,
      customerUserId: userB,
      termsVersion: "2026-08-01",
      consentedAt: "2026-09-09T11:00:00.000Z",
    });

    const foundA = repo.findLatestForOrder(ctxA, orderA);
    const foundB = repo.findLatestForOrder(ctxB, orderB);
    expect(foundA?.termsVersion).toBe("2026-09-01");
    expect(foundB?.termsVersion).toBe("2026-08-01");

    // Merchant B's context must not see merchant A's consent even by order id lookup under its own scope.
    expect(repo.findLatestForOrder(ctxB, orderA)).toBeUndefined();
    expect(repo.findLatestForOrder(ctxA, orderB)).toBeUndefined();
  });

  it("returns the most recent consent when a customer re-consents to a later terms version", () => {
    const ctxA = createTenantContext(merchantA);
    repo.record(ctxA, {
      orderId: orderA,
      customerUserId: userA,
      termsVersion: "2026-01-01",
      consentedAt: "2026-01-01T00:00:00.000Z",
    });
    repo.record(ctxA, {
      orderId: orderA,
      customerUserId: userA,
      termsVersion: "2026-09-01",
      consentedAt: "2026-09-09T10:00:00.000Z",
    });

    const latest = repo.findLatestForOrder(ctxA, orderA);
    expect(latest?.termsVersion).toBe("2026-09-01");
  });
});
