import { createTenantContext } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createPgConnection, type PgConnection } from "../pg-connection.js";
import { runPgMigrations } from "../migrate.js";
import * as pgSchema from "../schema/pg.js";
import { ReservationConflictError } from "./ReservationRepository.js";
import { PgReservationRepository } from "./PgReservationRepository.js";

/**
 * `docs/design/05` "Fungible capacity" / `docs/cards/D054.md` — the
 * PostgreSQL side of the capacity-checked write path. Migration 0011
 * narrowed the `reservations_no_overlap` exclusion constraint (D051) to
 * `INVENTORY_UNIT` subjects only, because an exclusion constraint cannot
 * express "sum of overlapping quantities <= capacity". For `RESOURCE`
 * subjects — including `capacity = 1` ones, which this repository's default
 * covers too — admission is enforced here instead: `SELECT ... FOR UPDATE`
 * on the `resources` row serializes concurrent bookings for that resource,
 * then the sum of overlapping blocking reservations' `quantity` is checked
 * against `capacity` before inserting, all inside one transaction.
 */
const merchantId = "018e6b3a-9c3e-7000-8000-0000000000f1";
const locationId = "018e6b3a-9c3e-7000-8000-0000000000f2";
const resourceId = "018e6b3a-9c3e-7000-8000-0000000000f3";

async function freshConnection(capacity: number): Promise<PgConnection> {
  const connectionString = process.env.DATABASE_URL as string;
  const connection = createPgConnection(connectionString);

  await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
  await connection.pool.query('CREATE SCHEMA "public"');
  await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
  await runPgMigrations(connection);

  await connection.db.insert(pgSchema.merchants).values({
    id: merchantId,
    name: "Acme Studio",
    slug: "acme-studio",
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
  });
  await connection.db.insert(pgSchema.locations).values({
    id: locationId,
    merchantId,
    name: "Main studio",
    timezone: "UTC",
  });
  await connection.db.insert(pgSchema.resources).values({
    id: resourceId,
    merchantId,
    locationId,
    kind: "ROOM",
    name: "Studio A",
    capacity,
  });

  return connection;
}

describe.skipIf(!process.env.DATABASE_URL)("PgReservationRepository.createGuarded (D054, real PostgreSQL)", () => {
  it("admits two adjacent bookings on a capacity-1 resource — ends_at of one equals starts_at of the next", async () => {
    const connection = await freshConnection(1);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);

      const firstId = await repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );
      const secondId = await repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T10:00:00.000Z",
          endsAt: "2026-10-01T11:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );

      expect(firstId).not.toEqual(secondId);
      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(2);
    } finally {
      await connection.pool.end();
    }
  });

  it("rejects a 1-second overlap on a capacity-1 resource, and writes nothing", async () => {
    const connection = await freshConnection(1);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);

      await repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );

      await expect(
        repo.createGuarded(
          ctx,
          {
            subjectType: "RESOURCE",
            subjectId: resourceId,
            startsAt: "2026-10-01T09:59:59.000Z",
            endsAt: "2026-10-01T10:59:59.000Z",
            quantity: 1,
            state: "CONFIRMED",
            createdAt: "2026-10-01T08:45:01.000Z",
          },
          1,
        ),
      ).rejects.toThrow(ReservationConflictError);

      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(1);
    } finally {
      await connection.pool.end();
    }
  });

  it("capacity=3 admits exactly 3 overlapping bookings and rejects the 4th", async () => {
    const connection = await freshConnection(3);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);

      for (let i = 0; i < 3; i++) {
        await repo.createGuarded(
          ctx,
          {
            subjectType: "RESOURCE",
            subjectId: resourceId,
            startsAt: "2026-10-01T09:00:00.000Z",
            endsAt: "2026-10-01T10:00:00.000Z",
            quantity: 1,
            state: "CONFIRMED",
            createdAt: `2026-10-01T08:45:0${i}.000Z`,
          },
          3,
        );
      }

      await expect(
        repo.createGuarded(
          ctx,
          {
            subjectType: "RESOURCE",
            subjectId: resourceId,
            startsAt: "2026-10-01T09:30:00.000Z",
            endsAt: "2026-10-01T10:30:00.000Z",
            quantity: 1,
            state: "CONFIRMED",
            createdAt: "2026-10-01T08:45:03.000Z",
          },
          3,
        ),
      ).rejects.toThrow(ReservationConflictError);

      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(3);
    } finally {
      await connection.pool.end();
    }
  });

  it("respects quantity, not just row count — two quantity-2 bookings exceed capacity 3", async () => {
    const connection = await freshConnection(3);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);

      await repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 2,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        3,
      );

      await expect(
        repo.createGuarded(
          ctx,
          {
            subjectType: "RESOURCE",
            subjectId: resourceId,
            startsAt: "2026-10-01T09:00:00.000Z",
            endsAt: "2026-10-01T10:00:00.000Z",
            quantity: 2,
            state: "CONFIRMED",
            createdAt: "2026-10-01T08:45:01.000Z",
          },
          3,
        ),
      ).rejects.toThrow(ReservationConflictError);

      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(1);
    } finally {
      await connection.pool.end();
    }
  });

  it("D056: an expired-but-unswept HELD reservation on an INVENTORY_UNIT does not block a new overlapping request", async () => {
    const connection = await freshConnection(1);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);
      const inventoryUnitId = "018e6b3a-9c3e-7000-8000-0000000000fa";

      // First request holds the unit, then the hold's expiresAt passes —
      // no sweeper has run yet, so this row is still `state = 'HELD'` on
      // disk (docs/cards/D056.md's exact scenario).
      await repo.createGuarded(
        ctx,
        {
          subjectType: "INVENTORY_UNIT",
          subjectId: inventoryUnitId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "HELD",
          expiresAt: "2026-10-01T08:50:00.000Z",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );

      // A second, overlapping request arrives after expiry — it must be
      // admitted, since the first hold is no longer actually blocking, even
      // though its row is still `state = 'HELD'` until the sweeper runs.
      const secondId = await repo.createGuarded(
        ctx,
        {
          subjectType: "INVENTORY_UNIT",
          subjectId: inventoryUnitId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "HELD",
          expiresAt: "2026-10-01T09:15:00.000Z",
          createdAt: "2026-10-01T09:00:00.000Z",
        },
        1,
      );

      expect(secondId).toBeTruthy();
      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(2);
    } finally {
      await connection.pool.end();
    }
  });

  it("is tenant-scoped — merchant B's blocking reservation is not summed against merchant A's capacity check", async () => {
    const connection = await freshConnection(1);
    try {
      const merchantB = "018e6b3a-9c3e-7000-8000-0000000000f9";
      await connection.db.insert(pgSchema.merchants).values({
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
      });

      const repo = new PgReservationRepository(connection.pool);
      const ctxA = createTenantContext(merchantId);
      const ctxB = createTenantContext(merchantB);

      // Same subject id reused across tenants — should not conflict, since
      // findBlocking is merchant-scoped (docs/design/07 Control #1).
      const idA = await repo.createGuarded(
        ctxA,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );
      const idB = await repo.createGuarded(
        ctxB,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
        },
        1,
      );

      expect(idA).not.toEqual(idB);
      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(2);
    } finally {
      await connection.pool.end();
    }
  });

  /**
   * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — same
   * behavior as `ReservationRepository.createGuarded` (SQLite): the
   * requested `endsAt` is expanded by `bufferMinutes` before both the
   * overlap check and the insert, and `bufferMinutes` itself is stored on
   * the row.
   */
  it("D064: expands endsAt by bufferMinutes at write time and stores bufferMinutes on the row", async () => {
    const connection = await freshConnection(1);
    try {
      const repo = new PgReservationRepository(connection.pool);
      const ctx = createTenantContext(merchantId);

      const id = await repo.createGuarded(
        ctx,
        {
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          quantity: 1,
          state: "CONFIRMED",
          createdAt: "2026-10-01T08:45:00.000Z",
          bufferMinutes: 30,
        },
        1,
      );

      const rows = await connection.db.select().from(pgSchema.reservations);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(id);
      expect(rows[0]?.endsAt.toISOString()).toBe("2026-10-01T10:30:00.000Z");
      expect(rows[0]?.bufferMinutes).toBe(30);

      // The buffer expanded this booking's effective end to 10:30, so a
      // second booking starting at the unbuffered 10:00 now conflicts.
      await expect(
        repo.createGuarded(
          ctx,
          {
            subjectType: "RESOURCE",
            subjectId: resourceId,
            startsAt: "2026-10-01T10:00:00.000Z",
            endsAt: "2026-10-01T11:00:00.000Z",
            quantity: 1,
            state: "CONFIRMED",
            createdAt: "2026-10-01T08:46:00.000Z",
          },
          1,
        ),
      ).rejects.toThrow(ReservationConflictError);
    } finally {
      await connection.pool.end();
    }
  });
});
