import { createTenantContext, generateUuidV7, ForbiddenActionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { HoldExpiredError, ReservationConflictError, ReservationRepository } from "../repositories/ReservationRepository.js";
import { ResourceRepository } from "../repositories/ResourceRepository.js";
import { BookingService, HoldLimitExceededError, MissingIdempotencyKeyError } from "./BookingService.js";

describe("BookingService", () => {
  let connection: Connection;
  let service: BookingService;
  let merchantA: string;
  let resourceA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    service = new BookingService(new ResourceRepository(connection), new ReservationRepository(connection));

    merchantA = generateUuidV7();
    const locationA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.locations).values({
      id: locationA,
      merchantId: merchantA,
      name: "A Shop",
      timezone: "America/Los_Angeles",
    });

    resourceA = generateUuidV7();
    await connection.db.insert(sqliteSchema.resources).values({
      id: resourceA,
      merchantId: merchantA,
      locationId: locationA,
      kind: "STAFF",
      name: "Jane",
      capacity: 1,
    });
  });

  it("createServiceBooking() occupies the resource with a HELD reservation (D059 acceptance)", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-1",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const reservationRepo = new ReservationRepository(connection);
    const row = reservationRepo.findById(ctx, id);
    expect(row).toMatchObject({ subjectType: "RESOURCE", subjectId: resourceA, state: "HELD" });
  });

  it("createServiceBooking() rejects a conflicting booking on the same resource (D059 acceptance)", () => {
    const ctx = createTenantContext(merchantA);

    service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-1",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(() =>
      service.createServiceBooking(ctx, "STAFF", {
        resourceId: resourceA,
        startsAt: "2026-10-01T09:30:00.000Z",
        endsAt: "2026-10-01T10:30:00.000Z",
        quantity: 1,
        idempotencyKey: "idem-2",
        createdAt: "2026-10-01T08:46:00.000Z",
      }),
    ).toThrow(ReservationConflictError);
  });

  it("security: createServiceBooking() requires an Idempotency-Key", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.createServiceBooking(ctx, "STAFF", {
        resourceId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        idempotencyKey: "",
        createdAt: "2026-10-01T08:45:00.000Z",
      }),
    ).toThrow(MissingIdempotencyKeyError);
  });

  it("security: retrying createServiceBooking() with the same Idempotency-Key replays the original booking instead of double-occupying the resource", () => {
    const ctx = createTenantContext(merchantA);

    const firstId = service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-retry",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const secondId = service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-retry",
      createdAt: "2026-10-01T08:45:05.000Z",
    });

    expect(secondId).toEqual(firstId);

    const reservationRepo = new ReservationRepository(connection);
    const rows = reservationRepo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:45:05.000Z",
    );
    expect(rows).toHaveLength(1);
  });

  it("confirmServiceBooking() transitions HELD to CONFIRMED (D059 deliverable)", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-confirm",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    service.confirmServiceBooking(ctx, "STAFF", id, "2026-10-01T08:50:00.000Z");

    const reservationRepo = new ReservationRepository(connection);
    const row = reservationRepo.findById(ctx, id);
    expect(row?.state).toEqual("CONFIRMED");
  });

  it("security: confirmServiceBooking() throws HoldExpiredError instead of silently confirming an expired hold (D127)", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.createServiceBooking(ctx, "STAFF", {
      resourceId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      idempotencyKey: "idem-expired-confirm",
      createdAt: "2026-10-01T08:45:00.000Z",
      expiresAt: "2026-10-01T09:00:00.000Z",
    });

    expect(() => service.confirmServiceBooking(ctx, "STAFF", id, "2026-10-01T09:00:00.001Z")).toThrow(
      HoldExpiredError,
    );

    const reservationRepo = new ReservationRepository(connection);
    expect(reservationRepo.findById(ctx, id)?.state).toEqual("HELD");
  });

  describe("authorization — booking creation restricted to roles with bookings:manage", () => {
    const rolesAllowed = ["OWNER", "ADMIN", "STAFF"] as const;

    it.each(rolesAllowed)("createServiceBooking() succeeds for %s", (role) => {
      const ctx = createTenantContext(merchantA);
      expect(() =>
        service.createServiceBooking(ctx, role, {
          resourceId: resourceA,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          idempotencyKey: `idem-${role}`,
          createdAt: "2026-10-01T08:45:00.000Z",
        }),
      ).not.toThrow();
    });

    it("createServiceBooking() is forbidden for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      expect(() =>
        service.createServiceBooking(ctx, "READ_ONLY", {
          resourceId: resourceA,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          idempotencyKey: "idem-ro",
          createdAt: "2026-10-01T08:45:00.000Z",
        }),
      ).toThrow(ForbiddenActionError);
    });
  });

  describe("hold exhaustion limits — docs/cards/D062.md, GATE G3", () => {
    // Each booking targets a distinct non-overlapping window so the cap is
    // what rejects the request, not `ReservationConflictError`.
    function windowFor(hour: number): { startsAt: string; endsAt: string } {
      const startsAt = `2026-11-01T${String(hour).padStart(2, "0")}:00:00.000Z`;
      const endsAt = `2026-11-01T${String(hour + 1).padStart(2, "0")}:00:00.000Z`;
      return { startsAt, endsAt };
    }

    it("rejects a new hold once an authenticated account is at its concurrent-hold cap", () => {
      const ctx = createTenantContext(merchantA);
      const strict = new BookingService(new ResourceRepository(connection), new ReservationRepository(connection), {
        perAccountLimit: 2,
        perIpLimit: 20,
        anonymousLimit: 1,
      });
      const accountId = generateUuidV7();

      for (let i = 0; i < 2; i++) {
        strict.createServiceBooking(ctx, "STAFF", {
          resourceId: resourceA,
          ...windowFor(9 + i),
          quantity: 1,
          idempotencyKey: `idem-account-${i}`,
          createdAt: "2026-10-01T08:45:00.000Z",
          createdByAccountId: accountId,
        });
      }

      expect(() =>
        strict.createServiceBooking(ctx, "STAFF", {
          resourceId: resourceA,
          ...windowFor(20),
          quantity: 1,
          idempotencyKey: "idem-account-over",
          createdAt: "2026-10-01T08:45:00.000Z",
          createdByAccountId: accountId,
        }),
      ).toThrow(HoldLimitExceededError);
    });

    it("applies a stricter cap to an anonymous caller (no account id) than an authenticated one on the same IP", () => {
      const ctx = createTenantContext(merchantA);
      const strict = new BookingService(new ResourceRepository(connection), new ReservationRepository(connection), {
        perAccountLimit: 5,
        perIpLimit: 5,
        anonymousLimit: 1,
      });
      const ip = "203.0.113.9";

      strict.createServiceBooking(ctx, "STAFF", {
        resourceId: resourceA,
        ...windowFor(9),
        quantity: 1,
        idempotencyKey: "idem-anon-1",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByIp: ip,
      });

      expect(() =>
        strict.createServiceBooking(ctx, "STAFF", {
          resourceId: resourceA,
          ...windowFor(10),
          quantity: 1,
          idempotencyKey: "idem-anon-2",
          createdAt: "2026-10-01T08:45:00.000Z",
          createdByIp: ip,
        }),
      ).toThrow(HoldLimitExceededError);
    });

    it("an expired hold does not count against the cap (lazy expiry, no sweeper dependency)", () => {
      const ctx = createTenantContext(merchantA);
      const strict = new BookingService(new ResourceRepository(connection), new ReservationRepository(connection), {
        perAccountLimit: 1,
        perIpLimit: 20,
        anonymousLimit: 1,
      });
      const accountId = generateUuidV7();

      strict.createServiceBooking(ctx, "STAFF", {
        resourceId: resourceA,
        ...windowFor(9),
        quantity: 1,
        idempotencyKey: "idem-expired-1",
        createdAt: "2026-10-01T08:00:00.000Z",
        expiresAt: "2026-10-01T08:10:00.000Z",
        createdByAccountId: accountId,
      });

      expect(() =>
        strict.createServiceBooking(ctx, "STAFF", {
          resourceId: resourceA,
          ...windowFor(10),
          quantity: 1,
          idempotencyKey: "idem-expired-2",
          // Later than the first hold's expiry — the cap check must treat it as free.
          createdAt: "2026-10-01T09:00:00.000Z",
          createdByAccountId: accountId,
        }),
      ).not.toThrow();
    });
  });
});
