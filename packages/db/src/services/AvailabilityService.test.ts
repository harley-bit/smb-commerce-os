import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvailabilityCache } from "../cache/AvailabilityCache.js";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { AvailabilityExceptionRepository } from "../repositories/AvailabilityExceptionRepository.js";
import { AvailabilityRuleRepository } from "../repositories/AvailabilityRuleRepository.js";
import { LocationRepository } from "../repositories/LocationRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { ResourceRepository } from "../repositories/ResourceRepository.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AvailabilityRangeTooLargeError, AvailabilityService, ResourceNotFoundError } from "./AvailabilityService.js";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05T00:00:00.000Z";
const NEXT_MONDAY = "2026-10-12T00:00:00.000Z";

describe("AvailabilityService", () => {
  let connection: Connection;
  let cache: AvailabilityCache;
  let service: AvailabilityService;
  let reservations: ReservationRepository;
  let merchantId: string;
  let resourceId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    cache = new AvailabilityCache();

    const resources = new ResourceRepository(connection);
    const locations = new LocationRepository(connection);
    const rules = new AvailabilityRuleRepository(connection);
    const exceptions = new AvailabilityExceptionRepository(connection);
    reservations = new ReservationRepository(connection, cache);
    service = new AvailabilityService(resources, locations, rules, exceptions, reservations, cache);

    merchantId = generateUuidV7();
    const ctx = createTenantContext(merchantId);
    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantId,
      name: "Acme",
      slug: `acme-${merchantId}`,
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: CREATED_AT,
    });

    const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });
    resourceId = resources.create(ctx, { locationId, kind: "STAFF", name: "Jane", capacity: 1 });
    rules.create(ctx, { resourceId, weekday: 1, startTime: "09:00", endTime: "17:00" });
  });

  it("returns free intervals computed from the resource's availability rule", () => {
    const ctx = createTenantContext(merchantId);
    const free = service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    expect(free).toEqual([{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T17:00:00.000Z" }]);
  });

  it("excludes a blocking reservation from the free intervals", () => {
    const ctx = createTenantContext(merchantId);
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceId,
      startsAt: "2026-10-05T10:00:00.000Z",
      endsAt: "2026-10-05T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const free = service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    expect(free).toEqual([
      { start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z" },
      { start: "2026-10-05T11:00:00.000Z", end: "2026-10-05T17:00:00.000Z" },
    ]);
  });

  it("never reveals who booked a slot — only that it is unavailable", () => {
    const ctx = createTenantContext(merchantId);
    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceId,
      startsAt: "2026-10-05T10:00:00.000Z",
      endsAt: "2026-10-05T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const free = service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    const serialized = JSON.stringify(free);
    expect(serialized).not.toContain("subjectId");
    expect(serialized).not.toContain("orderLineId");
    expect(serialized).not.toContain("id");
  });

  it("rejects a window wider than 90 days", () => {
    const ctx = createTenantContext(merchantId);
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-04-15T00:00:00.000Z"; // > 90 days
    expect(() => service.getResourceAvailability(ctx, resourceId, from, to, from)).toThrow(
      AvailabilityRangeTooLargeError,
    );
  });

  it("accepts a window of exactly 90 days", () => {
    const ctx = createTenantContext(merchantId);
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-04-01T00:00:00.000Z"; // exactly 90 days
    expect(() => service.getResourceAvailability(ctx, resourceId, from, to, from)).not.toThrow();
  });

  it("throws ResourceNotFoundError for an unknown resource", () => {
    const ctx = createTenantContext(merchantId);
    expect(() => service.getResourceAvailability(ctx, generateUuidV7(), MONDAY, NEXT_MONDAY, MONDAY)).toThrow(
      ResourceNotFoundError,
    );
  });

  it("caches the computed result — a second identical call does not recompute", () => {
    const ctx = createTenantContext(merchantId);
    const spy = vi.spyOn(reservations, "findBlocking");

    service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("acceptance criterion — cache is invalidated on any reservation write for that subject", () => {
    const ctx = createTenantContext(merchantId);

    const before = service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    expect(before).toEqual([{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T17:00:00.000Z" }]);

    reservations.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceId,
      startsAt: "2026-10-05T10:00:00.000Z",
      endsAt: "2026-10-05T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const after = service.getResourceAvailability(ctx, resourceId, MONDAY, NEXT_MONDAY, MONDAY);
    expect(after).toEqual([
      { start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z" },
      { start: "2026-10-05T11:00:00.000Z", end: "2026-10-05T17:00:00.000Z" },
    ]);
  });

  it("cross-tenant isolation — merchant B's identical resource id never surfaces merchant A's rules", () => {
    const ctxA = createTenantContext(merchantId);
    const merchantB = generateUuidV7();
    const ctxB = createTenantContext(merchantB);

    expect(() => service.getResourceAvailability(ctxB, resourceId, MONDAY, NEXT_MONDAY, MONDAY)).toThrow(
      ResourceNotFoundError,
    );
    // Sanity: merchant A's own lookup still works (ctxA is exercised too, proving the isolation is on ctx not just resourceId).
    expect(service.getResourceAvailability(ctxA, resourceId, MONDAY, NEXT_MONDAY, MONDAY)).toHaveLength(1);
  });
});
