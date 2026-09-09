import { createTenantContext, generateUuidV7, NoAvailableUnitError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { InventoryUnitRepository } from "../repositories/InventoryUnitRepository.js";
import { InventoryMovementRepository } from "../repositories/InventoryMovementRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { ConditionReportRepository } from "../repositories/ConditionReportRepository.js";
import { ConditionMediaRepository } from "../repositories/ConditionMediaRepository.js";
import { FulfillmentEventRepository } from "../repositories/FulfillmentEventRepository.js";
import { DepositAuthorizationRepository } from "../repositories/DepositAuthorizationRepository.js";
import { verifyAuditChain } from "../audit/verifyChain.js";
import { InventoryUnitService } from "./InventoryUnitService.js";
import { InventoryService } from "./InventoryService.js";
import { RentalReservationService } from "./RentalReservationService.js";
import { ConditionReportService } from "./ConditionReportService.js";
import { FulfillmentEventService, MissingCheckoutConditionReportError } from "./FulfillmentEventService.js";
import { ProductSaleService, UnitCurrentlyRentedError } from "./ProductSaleService.js";

/**
 * Gate G4 (`docs/design/01`): "reserve, checkout, use, return, settle" for a
 * rental, end to end through the real service layer built across
 * D064–D085, verifying invariants I3, I4, I7 hold across the whole flow —
 * not just in each invariant's own unit test in isolation.
 */
describe("Gate G4 — rental lifecycle E2E", () => {
  let connection: Connection;
  let reservationRepo: ReservationRepository;
  let orderRepo: OrderRepository;
  let conditionReportRepo: ConditionReportRepository;
  let eventRepo: FulfillmentEventRepository;
  let depositRepo: DepositAuthorizationRepository;
  let unitRepo: InventoryUnitRepository;
  let rentalReservationService: RentalReservationService;
  let conditionReportService: ConditionReportService;
  let fulfillmentEventService: FulfillmentEventService;
  let productSaleService: ProductSaleService;
  let inventoryService: InventoryService;
  let inventoryUnitService: InventoryUnitService;

  let merchantA: string;
  let customerUserId: string;
  let staffUserId: string;
  let locationA: string;
  let listingA: string;
  let variantA: string;
  let unit1: string;
  let unit2: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const listingRepo = new ListingRepository(connection);
    const locationRepo = new LocationRepository(connection);
    const variantRepo = new VariantRepository(connection);
    unitRepo = new InventoryUnitRepository(connection);
    const movementRepo = new InventoryMovementRepository(connection);
    const auditLogRepo = new AuditLogRepository(connection);
    reservationRepo = new ReservationRepository(connection);
    orderRepo = new OrderRepository(connection);
    conditionReportRepo = new ConditionReportRepository(connection);
    const conditionMediaRepo = new ConditionMediaRepository(connection);
    eventRepo = new FulfillmentEventRepository(connection);
    depositRepo = new DepositAuthorizationRepository(connection);

    inventoryUnitService = new InventoryUnitService(unitRepo, auditLogRepo);
    inventoryService = new InventoryService(movementRepo, auditLogRepo);
    rentalReservationService = new RentalReservationService(variantRepo, unitRepo, reservationRepo);
    conditionReportService = new ConditionReportService(conditionReportRepo, orderRepo, conditionMediaRepo);
    fulfillmentEventService = new FulfillmentEventService(orderRepo, eventRepo, reservationRepo, conditionReportRepo);
    productSaleService = new ProductSaleService(
      variantRepo,
      movementRepo,
      inventoryUnitService,
      auditLogRepo,
      reservationRepo,
    );

    merchantA = generateUuidV7();
    customerUserId = generateUuidV7();
    staffUserId = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.users).values([
      { id: customerUserId, email: "customer@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
      { id: staffUserId, email: "staff@example.com", status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" },
    ]);

    const ctx = createTenantContext(merchantA);
    locationA = locationRepo.create(ctx, { name: "Main", timezone: "UTC" });
    listingA = listingRepo.create(ctx, {
      mode: "RENTAL",
      name: "Trailer",
      slug: "trailer",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    variantA = variantRepo.create(ctx, {
      listingId: listingA,
      mode: "RENTAL",
      sku: "TRAILER-1",
      name: "Trailer — default",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 20000,
      bufferMinutes: 0,
    });
    unit1 = unitRepo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "TRAILER-001",
      trackingMode: "SERIALIZED",
    });
    unit2 = unitRepo.create(ctx, {
      variantId: variantA,
      locationId: locationA,
      unitCode: "TRAILER-002",
      trackingMode: "SERIALIZED",
    });

    // Stock the two serialized units so ProductSaleService's ledger check
    // (invariant I5) doesn't stand in the way of exercising I3 later.
    inventoryService.receiveStock(ctx, "ADMIN", {
      variantId: variantA,
      locationId: locationA,
      quantity: 2,
      note: "Initial fleet receipt",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("reserve -> checkout -> use -> return -> settle holds I4 and I7 end to end", async () => {
    const ctx = createTenantContext(merchantA);

    // Invariant I4 up front: retire unit2 (as if it had already been sold
    // off the fleet) so only unit1 remains AVAILABLE. The allocator must
    // never hand out a SOLD/RETIRED unit.
    inventoryUnitService.transitionStatus(ctx, "OWNER", {
      unitId: unit2,
      newStatus: "RETIRED",
      actorUserId: staffUserId,
      note: "Retired from fleet before this rental",
      occurredAt: "2026-09-08T00:30:00.000Z",
    });

    // 1. CHECKOUT — the order and its rental line are created first (price
    // and deposit read from the server-side variant record).
    const orderId = orderRepo.create(ctx, { customerUserId, status: "CONFIRMED", currency: "USD" });
    const orderLineId = orderRepo.addLine(ctx, orderId, {
      listingId: listingA,
      variantId: variantA,
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 10000,
      depositMinor: 20000,
      startsAt: "2026-09-10T09:00:00.000Z",
      endsAt: "2026-09-12T09:00:00.000Z",
    });

    // 2. RESERVE — the guarded HELD reservation, linked to the order line,
    // picked from the AVAILABLE pool only (I4: unit2 is RETIRED and can
    // never be selected here, however many times this allocator runs).
    const reservationId = rentalReservationService.createRentalReservation(ctx, "STAFF", {
      variantId: variantA,
      orderLineId,
      startsAt: "2026-09-10T09:00:00.000Z",
      endsAt: "2026-09-12T09:00:00.000Z",
      idempotencyKey: "rental-e2e-1",
      createdAt: "2026-09-08T01:00:00.000Z",
    });
    const heldReservation = reservationRepo.findById(ctx, reservationId);
    expect(heldReservation).toMatchObject({ state: "HELD", subjectId: unit1, orderLineId });

    // Payment + deposit authorization, holding the customer's deposit.
    const paymentId = generateUuidV7();
    await connection.db.insert(sqliteSchema.payments).values({
      id: paymentId,
      merchantId: merchantA,
      orderId,
      provider: "stripe",
      providerRef: `pi_${paymentId}`,
      kind: "DEPOSIT_HOLD",
      amountMinor: 20000,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T01:00:00.000Z",
    });
    const depositId = depositRepo.create(ctx, {
      orderLineId,
      paymentId,
      amountMinor: 20000,
      currency: "USD",
      authorizedAt: "2026-09-08T01:05:00.000Z",
      expiresAt: "2026-10-08T01:05:00.000Z",
    });
    expect(depositRepo.findById(ctx, depositId)).toMatchObject({ state: "AUTHORIZED" });

    // Checkout confirms the hold.
    reservationRepo.confirm(ctx, reservationId);
    expect(reservationRepo.findById(ctx, reservationId)?.state).toEqual("CONFIRMED");

    // 3. USE — I7: pickup is refused with no CHECKOUT condition report on
    // file, and neither the reservation nor the event log moves.
    expect(() =>
      fulfillmentEventService.recordPickup(ctx, "STAFF", {
        orderLineId,
        occurredAt: "2026-09-10T09:00:00.000Z",
        actorUserId: staffUserId,
        note: "Attempted pickup with no baseline.",
      }),
    ).toThrow(MissingCheckoutConditionReportError);
    expect(reservationRepo.findById(ctx, reservationId)?.state).toEqual("CONFIRMED");
    expect(eventRepo.listByOrderLine(ctx, orderLineId)).toEqual([]);

    // Baseline recorded via D116's checkout flow, so pickup can now legally proceed.
    conditionReportService.recordCheckout(ctx, "STAFF", {
      orderLineId,
      inventoryUnitId: unit1,
      conditionGrade: "GOOD",
      createdBy: staffUserId,
      createdAt: "2026-09-10T08:55:00.000Z",
    });
    fulfillmentEventService.recordPickup(ctx, "STAFF", {
      orderLineId,
      occurredAt: "2026-09-10T09:00:00.000Z",
      actorUserId: staffUserId,
      note: "Customer picked up trailer.",
    });
    expect(reservationRepo.findById(ctx, reservationId)?.state).toEqual("IN_USE");

    // I3's underlying predicate, mid-rental: unit1 currently has a blocking
    // reservation over "now" — the same check `ProductSaleService.sellProduct`
    // (`UnitCurrentlyRentedError`, exercised end to end below) consults
    // before it will let a unit be sold.
    expect(
      reservationRepo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", unit1, "2026-09-11T00:00:00.000Z"),
    ).toBe(true);

    // 4. RETURN — CHECKIN condition report + fulfillment event.
    const checkinResult = conditionReportService.recordCheckin(ctx, "STAFF", {
      orderLineId,
      inventoryUnitId: unit1,
      conditionGrade: "GOOD",
      createdBy: staffUserId,
      createdAt: "2026-09-12T09:00:00.000Z",
    });
    expect(checkinResult.delta.deteriorated).toBe(false);
    expect(checkinResult.delta.unchanged).toBe(true);

    fulfillmentEventService.recordReturn(ctx, "STAFF", {
      orderLineId,
      occurredAt: "2026-09-12T09:00:00.000Z",
      actorUserId: staffUserId,
      note: "Trailer returned, no visible damage.",
    });
    expect(reservationRepo.findById(ctx, reservationId)).toMatchObject({
      state: "COMPLETED",
      releasedAt: "2026-09-12T09:00:00.000Z",
    });

    // 5. SETTLE — clean return, so the held deposit is released in full.
    depositRepo.release(ctx, depositId, "2026-09-12T09:05:00.000Z");
    expect(depositRepo.findById(ctx, depositId)).toMatchObject({ state: "RELEASED" });

    // I3's predicate, after return: no more blocking reservation over "now",
    // so a unit that just came back from a rental is sellable again.
    expect(
      reservationRepo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", unit1, "2026-09-13T00:00:00.000Z"),
    ).toBe(false);

    // Retired out of the fleet after this rental (the disposition a
    // RENTAL-mode unit actually takes in this system once its service life
    // ends — `ProductSaleService` is scoped to PRODUCT-mode variants only,
    // proven separately below).
    inventoryUnitService.transitionStatus(ctx, "OWNER", {
      unitId: unit1,
      newStatus: "RETIRED",
      actorUserId: staffUserId,
      note: "Retired from fleet after this rental",
      occurredAt: "2026-09-13T00:00:00.000Z",
    });

    // I4 again, post-retirement: unit1 is now RETIRED and unit2 already was
    // — the allocator must never pick either, and correctly has nothing
    // left for this variant.
    expect(() =>
      rentalReservationService.createRentalReservation(ctx, "STAFF", {
        variantId: variantA,
        startsAt: "2026-09-20T09:00:00.000Z",
        endsAt: "2026-09-21T09:00:00.000Z",
        idempotencyKey: "rental-e2e-2",
        createdAt: "2026-09-13T00:05:00.000Z",
      }),
    ).toThrow(NoAvailableUnitError);

    // The full chain of money-moving and state-changing writes made it into
    // the tamper-evident audit log, and the chain still verifies clean.
    const verification = verifyAuditChain(ctx, connection);
    expect(verification.valid).toBe(true);
  });

  it("invariant I3 — ProductSaleService rejects selling a unit with a blocking reservation, end to end", () => {
    const ctx = createTenantContext(merchantA);

    // A PRODUCT-mode listing entirely separate from the rental fleet above —
    // I3 ("an inventory unit with a blocking reservation cannot be sold") is
    // enforced on the sale path itself, independent of what kind of hold put
    // the reservation there.
    const productListingId = new ListingRepository(connection).create(ctx, {
      mode: "PRODUCT",
      name: "Floor Model Kayak",
      slug: "floor-model-kayak",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const productVariantId = new VariantRepository(connection).create(ctx, {
      listingId: productListingId,
      mode: "PRODUCT",
      sku: "KAYAK-FLOOR-1",
      name: "Floor Model Kayak — Standard",
      priceMinor: 30000,
      currency: "USD",
    });
    const productUnitId = unitRepo.create(ctx, {
      variantId: productVariantId,
      locationId: locationA,
      unitCode: "KAYAK-FLOOR-001",
      trackingMode: "SERIALIZED",
    });
    inventoryService.receiveStock(ctx, "ADMIN", {
      variantId: productVariantId,
      locationId: locationA,
      quantity: 1,
      note: "Floor model received",
      actorUserId: staffUserId,
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
    const reservationId = reservationRepo.create(ctx, {
      subjectType: "INVENTORY_UNIT",
      subjectId: productUnitId,
      startsAt: "2026-09-08T00:00:00.000Z",
      endsAt: "2026-09-20T00:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() =>
      productSaleService.sellProduct(ctx, "ADMIN", {
        variantId: productVariantId,
        unitId: productUnitId,
        locationId: locationA,
        quantity: 1,
        note: "Attempted sale of a currently-reserved unit — must be rejected",
        actorUserId: staffUserId,
        occurredAt: "2026-09-10T00:00:00.000Z",
      }),
    ).toThrow(UnitCurrentlyRentedError);
    expect(inventoryService.getStock(ctx, productVariantId, locationA)).toBe(1);
    expect(unitRepo.findById(ctx, productUnitId)?.status).toEqual("AVAILABLE");

    // Once the blocking reservation is cancelled, the same sale succeeds.
    reservationRepo.cancel(ctx, reservationId, "2026-09-10T00:00:00.000Z");
    const sale = productSaleService.sellProduct(ctx, "ADMIN", {
      variantId: productVariantId,
      unitId: productUnitId,
      locationId: locationA,
      quantity: 1,
      note: "Sold after the reservation was cancelled",
      actorUserId: staffUserId,
      occurredAt: "2026-09-10T00:05:00.000Z",
    });
    expect(sale.unitPriceMinor).toBe(30000);
    expect(inventoryService.getStock(ctx, productVariantId, locationA)).toBe(0);
    expect(unitRepo.findById(ctx, productUnitId)?.status).toEqual("SOLD");
  });
});
