import { createTenantContext, generateUuidV7, IllegalReservationTransitionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { FulfillmentEventRepository } from "../repositories/FulfillmentEventRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
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
  let reservationRepo: ReservationRepository;
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
    reservationRepo = new ReservationRepository(connection);
    service = new FulfillmentEventService(orderRepo, eventRepo, reservationRepo);

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

  describe("reservation state transitions — docs/cards/D071.md", () => {
    it("recordPickup() transitions the order line's linked reservation from CONFIRMED to IN_USE", () => {
      const ctx = createTenantContext(merchantA);
      const reservationId = reservationRepo.create(ctx, {
        orderLineId: orderLineA,
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-09-08T09:00:00.000Z",
        endsAt: "2026-09-10T09:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-09-08T08:00:00.000Z",
      });

      service.recordPickup(ctx, "OWNER", {
        orderLineId: orderLineA,
        occurredAt: "2026-09-08T12:00:00.000Z",
        actorUserId: userA,
        note: "Customer picked up trailer at store.",
      });

      expect(reservationRepo.findById(ctx, reservationId)?.state).toEqual("IN_USE");
    });

    it("recordReturn() transitions the order line's linked reservation from IN_USE to COMPLETED", () => {
      const ctx = createTenantContext(merchantA);
      const reservationId = reservationRepo.create(ctx, {
        orderLineId: orderLineA,
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-09-08T09:00:00.000Z",
        endsAt: "2026-09-10T09:00:00.000Z",
        quantity: 1,
        state: "IN_USE",
        createdAt: "2026-09-08T08:00:00.000Z",
      });

      service.recordReturn(ctx, "OWNER", {
        orderLineId: orderLineA,
        occurredAt: "2026-09-10T12:00:00.000Z",
        actorUserId: userA,
        note: "Customer returned trailer.",
      });

      expect(reservationRepo.findById(ctx, reservationId)).toMatchObject({
        state: "COMPLETED",
        releasedAt: "2026-09-10T12:00:00.000Z",
      });
    });

    it("recordReturn() rejects an order line whose reservation was never picked up — the service layer cannot skip straight to a direct state write", () => {
      const ctx = createTenantContext(merchantA);
      const reservationId = reservationRepo.create(ctx, {
        orderLineId: orderLineA,
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-09-08T09:00:00.000Z",
        endsAt: "2026-09-10T09:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-09-08T08:00:00.000Z",
      });

      expect(() =>
        service.recordReturn(ctx, "OWNER", {
          orderLineId: orderLineA,
          occurredAt: "2026-09-10T12:00:00.000Z",
          actorUserId: userA,
          note: "Attempted a return with no prior pickup.",
        }),
      ).toThrow(IllegalReservationTransitionError);

      // Neither the reservation nor the event log moved — an illegal
      // transition rejects the whole call, it doesn't record half of it.
      expect(reservationRepo.findById(ctx, reservationId)?.state).toEqual("CONFIRMED");
      expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([]);
    });

    it("recordPickup() is a no-op on reservation state when the order line has no linked reservation (e.g. a product sale line)", () => {
      const ctx = createTenantContext(merchantA);

      const id = service.recordPickup(ctx, "OWNER", {
        orderLineId: orderLineA,
        occurredAt: "2026-09-08T12:00:00.000Z",
        actorUserId: userA,
        note: "Picked up — no reservation linked to this line.",
      });

      expect(eventRepo.listByOrderLine(ctx, orderLineA)).toEqual([
        expect.objectContaining({ id, kind: "PICKED_UP" }),
      ]);
    });
  });
});
