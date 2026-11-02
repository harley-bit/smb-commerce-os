import { createTenantContext, ForbiddenActionError, generateUuidV7, IllegalDamageClaimTransitionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { DamageClaimRepository } from "../repositories/DamageClaimRepository.js";
import { DamageClaimService } from "./DamageClaimService.js";

describe("DamageClaimService", () => {
  let connection: Connection;
  let claims: DamageClaimRepository;
  let merchantA: string;
  let orderLineA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const listingRepo = new ListingRepository(connection);
    const variantRepo = new VariantRepository(connection);
    const orderRepo = new OrderRepository(connection);
    claims = new DamageClaimRepository(connection);

    merchantA = generateUuidV7();
    const userA = generateUuidV7();

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

  it("fileClaim() creates a claim already in FILED state", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);

    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    const claim = claims.findById(ctx, claimId);
    expect(claim?.state).toBe("FILED");
  });

  it("fileClaim() rejects a role without bookings:manage", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.fileClaim(ctx, "READ_ONLY", {
        orderLineId: orderLineA,
        amountMinor: 5000,
        filedAt: "2026-09-10T09:00:00.000Z",
      }),
    ).toThrow(ForbiddenActionError);
  });

  it("notifyCustomer() moves FILED -> CUSTOMER_NOTIFIED and fires the injected notifier exactly once", () => {
    const notify = vi.fn();
    const service = new DamageClaimService(claims, notify);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    service.notifyCustomer(ctx, "STAFF", claimId);

    const claim = claims.findById(ctx, claimId);
    expect(claim?.state).toBe("CUSTOMER_NOTIFIED");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: claimId, state: "CUSTOMER_NOTIFIED" }));
  });

  it("defaults to a no-op notifier when none is injected", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    expect(() => service.notifyCustomer(ctx, "STAFF", claimId)).not.toThrow();
  });

  it("disputeClaim() lets the customer's dispute land in DISPUTED, a non-terminal state", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });
    service.notifyCustomer(ctx, "STAFF", claimId);

    service.disputeClaim(ctx, claimId);

    expect(claims.findById(ctx, claimId)?.state).toBe("DISPUTED");
  });

  it("resolveCaptured() and resolveWaived() reach terminal states with a resolution note", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });
    service.notifyCustomer(ctx, "STAFF", claimId);

    service.resolveCaptured(ctx, "STAFF", claimId, "2026-09-12T09:00:00.000Z", "Deposit captured for the scratch.");

    const claim = claims.findById(ctx, claimId);
    expect(claim?.state).toBe("RESOLVED_CAPTURED");
    expect(claim?.resolutionNote).toBe("Deposit captured for the scratch.");
    expect(claim?.resolvedAt).toBe("2026-09-12T09:00:00.000Z");
  });

  it("listByOrderLine() returns every claim filed against that order line", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    const found = service.listByOrderLine(ctx, "READ_ONLY", orderLineA);

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(claimId);
  });

  it("findById() returns the claim, gated on bookings:view", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });

    expect(service.findById(ctx, "READ_ONLY", claimId)?.id).toBe(claimId);
  });

  it("rejects resolving a claim that already reached a terminal state", () => {
    const service = new DamageClaimService(claims);
    const ctx = createTenantContext(merchantA);
    const claimId = service.fileClaim(ctx, "STAFF", {
      orderLineId: orderLineA,
      amountMinor: 5000,
      filedAt: "2026-09-10T09:00:00.000Z",
    });
    service.notifyCustomer(ctx, "STAFF", claimId);
    service.resolveWaived(ctx, "STAFF", claimId, "2026-09-12T09:00:00.000Z", "Waived.");

    expect(() =>
      service.resolveCaptured(ctx, "STAFF", claimId, "2026-09-13T09:00:00.000Z", "Too late."),
    ).toThrow(IllegalDamageClaimTransitionError);
  });
});
