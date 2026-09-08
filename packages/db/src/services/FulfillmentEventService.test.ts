import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { FulfillmentEventRepository } from "../repositories/FulfillmentEventRepository.js";
import {
  FulfillmentEventService,
  OrderLineNotFoundError,
  MissingFulfillmentNoteError,
} from "./FulfillmentEventService.js";
import { ForbiddenActionError } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";

describe("FulfillmentEventService", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let orderRepo: OrderRepository;
  let eventRepo: FulfillmentEventRepository;
  let service: FulfillmentEventService;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let orderLineA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    eventRepo = new FulfillmentEventRepository(connection);
    service = new FulfillmentEventService(orderRepo, eventRepo);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    userA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.users).values({
      id: userA,
      email: "a@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const ctxA = createTenantContext(merchantA);
    const listingA = listingRepo.create(ctxA, {
      mode: "RENTAL",
      name: "A Trailer",
      slug: "a-trailer",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantA = variantRepo.create(ctxA, {
      listingId: listingA,
      mode: "RENTAL",
      sku: "A-SKU",
      name: "A Trailer - default",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
    });
    const orderA = orderRepo.create(ctxA, { customerUserId: userA, status: "CONFIRMED", currency: "USD" });
    orderLineA = orderRepo.addLine(ctxA, orderA, {
      listingId: listingA,
      variantId: variantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
  });

  const rolesThatCanRecord: MerchantUserRole[] = ["OWNER", "ADMIN", "STAFF"];
  const rolesThatCannotRecord: MerchantUserRole[] = ["READ_ONLY"];

  it.each(rolesThatCanRecord)("recordPickup() allows role %s and appends a PICKED_UP event with the actor", (role) => {
    const ctx = createTenantContext(merchantA);

    const id = service.recordPickup(ctx, role, {
      orderLineId: orderLineA,
      occurredAt: "2026-09-08T12:00:00.000Z",
      actorUserId: userA,
      note: "Customer picked up trailer at store.",
    });

    expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([
      expect.objectContaining({ id, kind: "PICKED_UP", actorUserId: userA }),
    ]);
  });

  it.each(rolesThatCanRecord)("recordReturn() allows role %s and appends a RETURNED event with the actor", (role) => {
    const ctx = createTenantContext(merchantA);

    const id = service.recordReturn(ctx, role, {
      orderLineId: orderLineA,
      occurredAt: "2026-09-10T12:00:00.000Z",
      actorUserId: userA,
      note: "Customer returned trailer.",
    });

    expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([
      expect.objectContaining({ id, kind: "RETURNED", actorUserId: userA }),
    ]);
  });

  it.each(rolesThatCannotRecord)("recordPickup() rejects role %s before any write", (role) => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.recordPickup(ctx, role, {
        orderLineId: orderLineA,
        occurredAt: "2026-09-08T12:00:00.000Z",
        actorUserId: userA,
        note: "Attempted pickup.",
      }),
    ).toThrow(ForbiddenActionError);

    expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([]);
  });

  it("recordPickup() throws OrderLineNotFoundError for an order line belonging to another merchant", () => {
    const ctxB = createTenantContext(merchantB);

    expect(() =>
      service.recordPickup(ctxB, "OWNER", {
        orderLineId: orderLineA,
        occurredAt: "2026-09-08T12:00:00.000Z",
        actorUserId: userA,
        note: "Cross-tenant attempt.",
      }),
    ).toThrow(OrderLineNotFoundError);
  });

  it("recordReturn() throws OrderLineNotFoundError for a non-existent order line", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.recordReturn(ctx, "OWNER", {
        orderLineId: "does-not-exist",
        occurredAt: "2026-09-10T12:00:00.000Z",
        actorUserId: userA,
        note: "n/a",
      }),
    ).toThrow(OrderLineNotFoundError);
  });

  it("recordPickup() rejects an empty note — the event log is repudiation evidence, so it must say something", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.recordPickup(ctx, "OWNER", {
        orderLineId: orderLineA,
        occurredAt: "2026-09-08T12:00:00.000Z",
        actorUserId: userA,
        note: "   ",
      }),
    ).toThrow(MissingFulfillmentNoteError);

    expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([]);
  });
});
