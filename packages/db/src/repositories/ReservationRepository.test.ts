import { createTenantContext, generateUuidV7, IllegalReservationTransitionError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ReservationConflictError, ReservationRepository } from "./ReservationRepository.js";

describe("ReservationRepository", () => {
  let connection: Connection;
  let repo: ReservationRepository;
  let merchantA: string;
  let merchantB: string;
  let resourceA: string;
  let resourceB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new ReservationRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();

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

    const locationA = generateUuidV7();
    const locationB = generateUuidV7();
    await connection.db.insert(sqliteSchema.locations).values([
      { id: locationA, merchantId: merchantA, name: "Main", timezone: "UTC" },
      { id: locationB, merchantId: merchantB, name: "Main", timezone: "UTC" },
    ]);

    resourceA = generateUuidV7();
    resourceB = generateUuidV7();
    await connection.db.insert(sqliteSchema.resources).values([
      { id: resourceA, merchantId: merchantA, locationId: locationA, kind: "STAFF", name: "Jane", capacity: 1 },
      { id: resourceB, merchantId: merchantB, locationId: locationB, kind: "STAFF", name: "Jo", capacity: 1 },
    ]);
  });

  it("findBlocking() returns a HELD reservation overlapping the query range", () => {
    const ctx = createTenantContext(merchantA);
    repo.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:30:00.000Z",
      "2026-10-01T11:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "HELD", subjectId: resourceA });
  });

  it("findBlocking() excludes non-overlapping intervals before or after the range", () => {
    const ctx = createTenantContext(merchantA);
    repo.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T06:00:00.000Z",
      endsAt: "2026-10-01T07:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T05:00:00.000Z",
    });
    repo.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T12:00:00.000Z",
      endsAt: "2026-10-01T13:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T05:00:00.000Z",
    });

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:00:00.000Z",
    );

    expect(rows).toEqual([]);
  });

  it("excludes COMPLETED, CANCELLED, and EXPIRED reservations even when the interval overlaps", () => {
    const ctx = createTenantContext(merchantA);
    const nonBlockingStates = ["COMPLETED", "CANCELLED", "EXPIRED"] as const;

    for (const state of nonBlockingStates) {
      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state,
        createdAt: "2026-10-01T08:00:00.000Z",
      });
    }

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:00:00.000Z",
    );

    expect(rows).toEqual([]);
  });

  it("security: a HELD reservation whose hold has expired must not block, even though its state is still HELD", () => {
    const ctx = createTenantContext(merchantA);
    repo.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:05:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const asOfAfterExpiry = "2026-10-01T09:10:00.000Z";
    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      asOfAfterExpiry,
    );

    expect(rows).toEqual([]);
  });

  it("a HELD reservation still within its hold window does block", () => {
    const ctx = createTenantContext(merchantA);
    repo.create(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const asOfBeforeExpiry = "2026-10-01T09:10:00.000Z";
    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      asOfBeforeExpiry,
    );

    expect(rows).toHaveLength(1);
  });

  it("findBlocking() is tenant-scoped — cannot see another merchant's reservations for a same-shaped subject id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.create(ctxB, {
      subjectType: "RESOURCE",
      subjectId: resourceB,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const rows = repo.findBlocking(
      ctxA,
      "RESOURCE",
      resourceB,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:00:00.000Z",
    );

    expect(rows).toEqual([]);
  });

  it("findBlocking() query plan uses the reservations_subject_interval_idx index", () => {
    const ctx = createTenantContext(merchantA);
    const plan = repo
      .explainFindBlocking(ctx, "RESOURCE", resourceA, "2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", "2026-10-01T08:00:00.000Z")
      .map((row) => row.detail)
      .join(" | ");

    expect(plan).toContain("reservations_subject_interval_idx");
  });

  it("createGuarded() inserts when no blocking reservation overlaps (D050)", () => {
    const ctx = createTenantContext(merchantA);

    const id = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:45:00.000Z",
    );
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it("createGuarded() rejects a reservation that overlaps an existing blocking one, and writes nothing (D050)", () => {
    const ctx = createTenantContext(merchantA);
    repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(() =>
      repo.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:30:00.000Z",
        endsAt: "2026-10-01T10:30:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T09:00:00.000Z",
      }),
    ).toThrow(ReservationConflictError);

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T11:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
    );
    expect(rows).toHaveLength(1);
  });

  it("createGuarded() is tenant-scoped — merchant B booking the same-shaped subject id does not conflict with merchant A's booking", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const idA = repo.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });
    const idB = repo.createGuarded(ctxB, {
      subjectType: "RESOURCE",
      subjectId: resourceB,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(idA).not.toEqual(idB);
    expect(
      repo.findBlocking(
        ctxA,
        "RESOURCE",
        resourceB,
        "2026-10-01T09:00:00.000Z",
        "2026-10-01T10:00:00.000Z",
        "2026-10-01T08:45:00.000Z",
      ),
    ).toEqual([]);
  });

  it("createGuarded() admits two adjacent bookings on a capacity-1 resource — ends_at of one equals starts_at of the next (D054)", () => {
    const ctx = createTenantContext(merchantA);

    const firstId = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });
    const secondId = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T10:00:00.000Z",
      endsAt: "2026-10-01T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(firstId).not.toEqual(secondId);
    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T11:00:00.000Z",
      "2026-10-01T08:45:00.000Z",
    );
    expect(rows).toHaveLength(2);
  });

  it("createGuarded() rejects a 1-second overlap on a capacity-1 resource (D054)", () => {
    const ctx = createTenantContext(merchantA);

    repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(() =>
      repo.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:59:59.000Z",
        endsAt: "2026-10-01T10:59:59.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      }),
    ).toThrow(ReservationConflictError);
  });

  it("createGuarded() with capacity=3 admits exactly 3 overlapping bookings and rejects the 4th (D054)", () => {
    const ctx = createTenantContext(merchantA);

    const ids = [0, 1, 2].map((i) =>
      repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceA,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: `2026-10-01T08:45:0${i}.000Z`,
        },
        3,
      ),
    );
    expect(new Set(ids).size).toBe(3);

    expect(() =>
      repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceA,
          startsAt: "2026-10-01T09:30:00.000Z",
          endsAt: "2026-10-01T10:30:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:03.000Z",
        },
        3,
      ),
    ).toThrow(ReservationConflictError);

    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:45:03.000Z",
    );
    expect(rows).toHaveLength(3);
  });

  it("createGuarded() with capacity>1 respects quantity, not just row count — two quantity-2 bookings exceed capacity 3", () => {
    const ctx = createTenantContext(merchantA);

    repo.createGuarded(
      ctx,
      {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 2,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      },
      3,
    );

    expect(() =>
      repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceA,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 2,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:01.000Z",
        },
        3,
      ),
    ).toThrow(ReservationConflictError);
  });

  it("createGuarded() with an idempotencyKey replays the original row on retry instead of re-running the conflict check (D059)", () => {
    const ctx = createTenantContext(merchantA);

    const firstId = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
      idempotencyKey: "retry-key",
    });

    const secondId = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:05.000Z",
      idempotencyKey: "retry-key",
    });

    expect(secondId).toEqual(firstId);
    const rows = repo.findBlocking(
      ctx,
      "RESOURCE",
      resourceA,
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T08:45:05.000Z",
    );
    expect(rows).toHaveLength(1);
  });

  it("findByIdempotencyKey() is tenant-scoped — merchant B cannot see merchant A's key", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    repo.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      createdAt: "2026-10-01T08:45:00.000Z",
      idempotencyKey: "shared-key",
    });

    expect(repo.findByIdempotencyKey(ctxB, "shared-key")).toBeUndefined();
  });

  it("confirm() transitions a HELD reservation to CONFIRMED (D059)", () => {
    const ctx = createTenantContext(merchantA);
    const id = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    repo.confirm(ctx, id);

    expect(repo.findById(ctx, id)?.state).toEqual("CONFIRMED");
  });

  it("confirm() throws IllegalReservationTransitionError when the reservation is not HELD (D059)", () => {
    const ctx = createTenantContext(merchantA);
    const id = repo.createGuarded(ctx, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(() => repo.confirm(ctx, id)).toThrow(IllegalReservationTransitionError);
  });

  it("findById() is tenant-scoped — merchant B cannot read merchant A's reservation by id", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(repo.findById(ctxA, id)).toMatchObject({ id });
    expect(repo.findById(ctxB, id)).toBeUndefined();
  });

  it("confirm() is tenant-scoped — merchant B cannot confirm merchant A's reservation", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);

    const id = repo.createGuarded(ctxA, {
      subjectType: "RESOURCE",
      subjectId: resourceA,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    expect(() => repo.confirm(ctxB, id)).toThrow(`Reservation not found: ${id}`);
    expect(repo.findById(ctxA, id)?.state).toEqual("HELD");
  });

  describe("countActiveHoldsByAccount() — docs/cards/D062.md", () => {
    it("counts only unexpired HELD reservations for that account", () => {
      const ctx = createTenantContext(merchantA);
      const accountId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByAccountId: accountId,
      });
      // Already expired — must not count.
      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-02T09:00:00.000Z",
        endsAt: "2026-10-02T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:00:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByAccountId: accountId,
      });
      // CONFIRMED — no longer just a hold, must not count.
      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-03T09:00:00.000Z",
        endsAt: "2026-10-03T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByAccountId: accountId,
      });
      // Someone else's account — must not count.
      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-04T09:00:00.000Z",
        endsAt: "2026-10-04T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByAccountId: generateUuidV7(),
      });

      expect(repo.countActiveHoldsByAccount(ctx, accountId, "2026-10-01T09:00:00.000Z")).toBe(1);
    });

    it("is tenant-scoped — merchant B's identical account id does not count toward merchant A's cap", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const accountId = generateUuidV7();

      repo.create(ctxB, {
        subjectType: "RESOURCE",
        subjectId: resourceB,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByAccountId: accountId,
      });

      expect(repo.countActiveHoldsByAccount(ctxA, accountId, "2026-10-01T09:00:00.000Z")).toBe(0);
      expect(repo.countActiveHoldsByAccount(ctxB, accountId, "2026-10-01T09:00:00.000Z")).toBe(1);
    });
  });

  describe("countActiveHoldsByIp() — docs/cards/D062.md, the anonymous-cart cap", () => {
    it("counts only unexpired HELD reservations from that IP", () => {
      const ctx = createTenantContext(merchantA);
      const ip = "203.0.113.7";

      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByIp: ip,
      });
      repo.create(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-02T09:00:00.000Z",
        endsAt: "2026-10-02T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:00:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByIp: ip,
      });

      expect(repo.countActiveHoldsByIp(ctx, ip, "2026-10-01T09:00:00.000Z")).toBe(1);
    });

    it("is tenant-scoped — merchant B's identical IP does not count toward merchant A's cap", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const ip = "203.0.113.7";

      repo.create(ctxB, {
        subjectType: "RESOURCE",
        subjectId: resourceB,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
        createdByIp: ip,
      });

      expect(repo.countActiveHoldsByIp(ctxA, ip, "2026-10-01T09:00:00.000Z")).toBe(0);
      expect(repo.countActiveHoldsByIp(ctxB, ip, "2026-10-01T09:00:00.000Z")).toBe(1);
    });
  });

  /**
   * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — the
   * rental-variant buffer is applied by expanding the interval at write
   * time and storing both the expanded `endsAt` and the raw `bufferMinutes`
   * on the reservation row, so a later change to the variant's buffer can
   * never retroactively alter an already-written booking.
   */
  describe("buffer expansion (D064)", () => {
    it("createGuarded() expands the stored endsAt by bufferMinutes and records bufferMinutes on the row", () => {
      const ctx = createTenantContext(merchantA);

      const id = repo.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
        bufferMinutes: 30,
      });

      const row = repo.findById(ctx, id);
      expect(row?.startsAt).toBe("2026-10-01T09:00:00.000Z");
      expect(row?.endsAt).toBe("2026-10-01T10:30:00.000Z");
      expect(row?.bufferMinutes).toBe(30);
    });

    it("createGuarded() with no bufferMinutes stores endsAt unchanged and bufferMinutes null", () => {
      const ctx = createTenantContext(merchantA);

      const id = repo.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      const row = repo.findById(ctx, id);
      expect(row?.endsAt).toBe("2026-10-01T10:00:00.000Z");
      expect(row?.bufferMinutes).toBeNull();
    });

    it("buffer expansion creates a conflict: a second booking starting at the unbuffered end is rejected (G4)", () => {
      const ctx = createTenantContext(merchantA);
      const subjectId = generateUuidV7();

      repo.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
        bufferMinutes: 30,
      });

      // Without the buffer, 10:00-11:00 would not overlap 09:00-10:00 at all
      // (half-open interval). With the buffer expanding the first booking's
      // effective end to 10:30, this second request now conflicts.
      expect(() =>
        repo.createGuarded(ctx, {
          subjectType: "INVENTORY_UNIT",
          subjectId,
          startsAt: "2026-10-01T10:00:00.000Z",
          endsAt: "2026-10-01T11:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:46:00.000Z",
        }),
      ).toThrow(ReservationConflictError);
    });

    it("acceptance: a later variant buffer change does not alter an existing booking's stored interval", () => {
      const ctx = createTenantContext(merchantA);

      const firstId = repo.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
        bufferMinutes: 15,
      });
      const firstRow = repo.findById(ctx, firstId);

      // The variant's buffer subsequently changes to 60 minutes; a brand new
      // booking picks that up, but the earlier reservation is untouched
      // because its own buffer was snapshotted onto the row at write time,
      // never re-derived from the variant.
      const secondId = repo.createGuarded(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: generateUuidV7(),
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
        bufferMinutes: 60,
      });
      const secondRow = repo.findById(ctx, secondId);

      expect(firstRow?.endsAt).toBe("2026-10-01T10:15:00.000Z");
      expect(firstRow?.bufferMinutes).toBe(15);
      expect(secondRow?.endsAt).toBe("2026-10-01T11:00:00.000Z");
      expect(secondRow?.bufferMinutes).toBe(60);

      // Re-reading the first reservation again confirms it never changed.
      expect(repo.findById(ctx, firstId)?.endsAt).toBe("2026-10-01T10:15:00.000Z");
      expect(repo.findById(ctx, firstId)?.bufferMinutes).toBe(15);
    });
  });

  /**
   * `docs/cards/D066.md` — feeds `selectUnitForAllocation`'s
   * `AllocationCandidate.lastReturnedAt` for the rental unit allocator.
   */
  describe("lastReturnedAt() — docs/cards/D066.md", () => {
    it("returns null for a subject with no COMPLETED reservation", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.lastReturnedAt(ctx, "INVENTORY_UNIT", unitId)).toBeNull();
    });

    it("returns the endsAt of the most recent COMPLETED reservation for that subject", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-01T10:00:00.000Z",
        quantity: 1,
        state: "COMPLETED",
        createdAt: "2026-09-01T08:45:00.000Z",
      });
      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "COMPLETED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.lastReturnedAt(ctx, "INVENTORY_UNIT", unitId)).toBe("2026-10-01T10:00:00.000Z");
    });

    it("is tenant-scoped — merchant B's identical unit id does not leak its COMPLETED reservation to merchant A", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const unitId = generateUuidV7();

      repo.create(ctxB, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "COMPLETED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.lastReturnedAt(ctxA, "INVENTORY_UNIT", unitId)).toBeNull();
      expect(repo.lastReturnedAt(ctxB, "INVENTORY_UNIT", unitId)).toBe("2026-10-01T10:00:00.000Z");
    });
  });

  describe("isSubjectCurrentlyBlocked() — docs/cards/D067.md, invariant I3", () => {
    it("returns true when a CONFIRMED reservation covers the given instant", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-05T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", unitId, "2026-10-02T00:00:00.000Z")).toBe(true);
    });

    it("returns false once the reservation has ended", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-05T10:00:00.000Z",
        quantity: 1,
        state: "COMPLETED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", unitId, "2026-10-06T00:00:00.000Z")).toBe(false);
    });

    it("returns false for a subject with no reservation at all", () => {
      const ctx = createTenantContext(merchantA);
      expect(
        repo.isSubjectCurrentlyBlocked(ctx, "INVENTORY_UNIT", generateUuidV7(), "2026-10-02T00:00:00.000Z"),
      ).toBe(false);
    });

    it("is tenant-scoped — merchant B's identical unit id does not block merchant A's sale check", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const unitId = generateUuidV7();

      repo.create(ctxB, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-05T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.isSubjectCurrentlyBlocked(ctxA, "INVENTORY_UNIT", unitId, "2026-10-02T00:00:00.000Z")).toBe(false);
      expect(repo.isSubjectCurrentlyBlocked(ctxB, "INVENTORY_UNIT", unitId, "2026-10-02T00:00:00.000Z")).toBe(true);
    });
  });

  describe("findFutureBlocking() — docs/cards/D069.md", () => {
    it("returns a blocking reservation that starts after asOf", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      const id = repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-10T09:00:00.000Z",
        endsAt: "2026-10-12T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      const result = repo.findFutureBlocking(ctx, "INVENTORY_UNIT", unitId, "2026-10-01T00:00:00.000Z");
      expect(result.map((r) => r.id)).toEqual([id]);
    });

    it("excludes a reservation that starts at or before asOf", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      repo.create(ctx, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-10-05T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-09-25T08:45:00.000Z",
      });

      expect(repo.findFutureBlocking(ctx, "INVENTORY_UNIT", unitId, "2026-10-01T00:00:00.000Z")).toEqual([]);
    });

    it("excludes CANCELLED, COMPLETED, and EXPIRED reservations even though they start in the future", () => {
      const ctx = createTenantContext(merchantA);
      const unitId = generateUuidV7();

      for (const state of ["CANCELLED", "COMPLETED", "EXPIRED"] as const) {
        repo.create(ctx, {
          subjectType: "INVENTORY_UNIT",
          subjectId: unitId,
          startsAt: "2026-10-10T09:00:00.000Z",
          endsAt: "2026-10-12T10:00:00.000Z",
          quantity: 1,
          state,
          createdAt: "2026-10-01T08:45:00.000Z",
        });
      }

      expect(repo.findFutureBlocking(ctx, "INVENTORY_UNIT", unitId, "2026-10-01T00:00:00.000Z")).toEqual([]);
    });

    it("is tenant-scoped — merchant B's identical unit id is not returned for merchant A's future-blocking check", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);
      const unitId = generateUuidV7();

      repo.create(ctxB, {
        subjectType: "INVENTORY_UNIT",
        subjectId: unitId,
        startsAt: "2026-10-10T09:00:00.000Z",
        endsAt: "2026-10-12T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(repo.findFutureBlocking(ctxA, "INVENTORY_UNIT", unitId, "2026-10-01T00:00:00.000Z")).toEqual([]);
      expect(repo.findFutureBlocking(ctxB, "INVENTORY_UNIT", unitId, "2026-10-01T00:00:00.000Z")).toHaveLength(1);
    });
  });

  describe("cancel() — docs/cards/D069.md", () => {
    it("transitions a CONFIRMED reservation to CANCELLED and stamps releasedAt", () => {
      const ctx = createTenantContext(merchantA);
      const id = repo.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      repo.cancel(ctx, id, "2026-09-30T00:00:00.000Z");

      expect(repo.findById(ctx, id)).toMatchObject({ state: "CANCELLED", releasedAt: "2026-09-30T00:00:00.000Z" });
    });

    it("throws IllegalReservationTransitionError when the reservation is already terminal", () => {
      const ctx = createTenantContext(merchantA);
      const id = repo.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "COMPLETED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(() => repo.cancel(ctx, id, "2026-09-30T00:00:00.000Z")).toThrow(IllegalReservationTransitionError);
    });

    it("is tenant-scoped — merchant B cannot cancel merchant A's reservation", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);

      const id = repo.createGuarded(ctxA, {
        subjectType: "RESOURCE",
        subjectId: resourceA,
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "CONFIRMED",
        createdAt: "2026-10-01T08:45:00.000Z",
      });

      expect(() => repo.cancel(ctxB, id, "2026-09-30T00:00:00.000Z")).toThrow(`Reservation not found: ${id}`);
      expect(repo.findById(ctxA, id)?.state).toEqual("CONFIRMED");
    });
  });
});
