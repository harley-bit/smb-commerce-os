import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "./ListingRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { OrderRepository } from "./OrderRepository.js";
import { FulfillmentEventRepository } from "./FulfillmentEventRepository.js";

describe("FulfillmentEventRepository", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let variantRepo: VariantRepository;
  let orderRepo: OrderRepository;
  let repo: FulfillmentEventRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let userB: string;
  let orderLineA: string;
  let orderLineB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    variantRepo = new VariantRepository(connection);
    orderRepo = new OrderRepository(connection);
    repo = new FulfillmentEventRepository(connection);

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
        createdAt: "2026-09-08T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userA, email: "a@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
      { id: userB, email: "b@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

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

    const listingB = listingRepo.create(ctxB, {
      mode: "RENTAL",
      name: "B Trailer",
      slug: "b-trailer",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const variantB = variantRepo.create(ctxB, {
      listingId: listingB,
      mode: "RENTAL",
      sku: "B-SKU",
      name: "B Trailer - default",
      priceMinor: 6000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 25000,
    });
    const orderB = orderRepo.create(ctxB, { customerUserId: userB, status: "CONFIRMED", currency: "USD" });
    orderLineB = orderRepo.addLine(ctxB, orderB, {
      listingId: listingB,
      variantId: variantB,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 6000,
      lineTotalMinor: 6000,
    });
  });

  it("record() appends a fulfillment event scoped to the caller's merchant", () => {
    const ctxA = createTenantContext(merchantA);

    const id = repo.record(ctxA, {
      orderLineId: orderLineA,
      kind: "PICKED_UP",
      occurredAt: "2026-09-08T12:00:00.000Z",
      actorUserId: userA,
      note: "Customer picked up trailer at store.",
    });

    expect(repo.listByOrderLine(ctxA, orderLineA)).toEqual([
      expect.objectContaining({
        id,
        kind: "PICKED_UP",
        actorUserId: userA,
        note: "Customer picked up trailer at store.",
      }),
    ]);
  });

  it("listByOrderLine() never returns another merchant's events — tenant isolation", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.record(ctxA, {
      orderLineId: orderLineA,
      kind: "PICKED_UP",
      occurredAt: "2026-09-08T12:00:00.000Z",
      actorUserId: userA,
      note: "A picked up.",
    });
    repo.record(ctxB, {
      orderLineId: orderLineB,
      kind: "PICKED_UP",
      occurredAt: "2026-09-08T12:00:00.000Z",
      actorUserId: userB,
      note: "B picked up.",
    });

    expect(repo.listByOrderLine(ctxA, orderLineA)).toHaveLength(1);
    expect(repo.listByOrderLine(ctxB, orderLineA)).toEqual([]);
    expect(repo.listByOrderLine(ctxA, orderLineB)).toEqual([]);
    expect(repo.listByOrderLine(ctxB, orderLineB)).toHaveLength(1);
  });

  it("records multiple events in append order — never mutates a prior event", () => {
    const ctxA = createTenantContext(merchantA);

    repo.record(ctxA, {
      orderLineId: orderLineA,
      kind: "PICKED_UP",
      occurredAt: "2026-09-08T12:00:00.000Z",
      actorUserId: userA,
      note: "Picked up.",
    });
    repo.record(ctxA, {
      orderLineId: orderLineA,
      kind: "RETURNED",
      occurredAt: "2026-09-10T12:00:00.000Z",
      actorUserId: userA,
      note: "Returned.",
    });

    const events = repo.listByOrderLine(ctxA, orderLineA);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(["PICKED_UP", "RETURNED"]);
  });
});
