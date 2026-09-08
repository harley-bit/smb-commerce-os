import { describe, expect, it } from "vitest";
import { createPgConnection } from "../pg-connection.js";
import { runPgMigrations } from "../migrate.js";
import * as pgSchema from "./pg.js";

/**
 * `docs/design/05` C1 — the PostgreSQL-native "make it impossible" guarantee:
 * `EXCLUDE USING gist` on (subject_type, subject_id, tstzrange(starts_at,
 * ends_at)) filtered to the blocking states. Unlike D050's SQLite
 * `BEGIN IMMEDIATE` path, this constraint is enforced by the database engine
 * itself on every insert path — including a raw `INSERT` run directly
 * against the connection, with no application code involved at all. That is
 * the scenario these tests exercise: a "console session" that skips
 * `ReservationRepository` entirely.
 */
const merchantId = "018e6b3a-9c3e-7000-8000-0000000000a1";
const locationId = "018e6b3a-9c3e-7000-8000-0000000000a2";
const resourceId = "018e6b3a-9c3e-7000-8000-0000000000a3";

async function freshConnection() {
  const connectionString = process.env.DATABASE_URL as string;
  const connection = createPgConnection(connectionString);

  await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
  await connection.pool.query('CREATE SCHEMA "public"');
  await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
  await runPgMigrations(connection);

  await connection.db.insert(pgSchema.merchants).values({
    id: merchantId,
    name: "Acme Rentals",
    slug: "acme-rentals",
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
    kind: "STAFF",
    name: "Jane the instructor",
    capacity: 1,
  });

  return connection;
}

async function rawInsertReservation(
  connection: Awaited<ReturnType<typeof freshConnection>>,
  overrides: { id: string; startsAt: string; endsAt: string; state: string },
) {
  return connection.pool.query(
    `INSERT INTO reservations
       (id, merchant_id, subject_type, subject_id, starts_at, ends_at, quantity, state, expires_at, created_at)
     VALUES ($1, $2, 'RESOURCE', $3, $4, $5, 1, $6, $7, now())`,
    [
      overrides.id,
      merchantId,
      resourceId,
      overrides.startsAt,
      overrides.endsAt,
      overrides.state,
      overrides.state === "HELD" ? overrides.endsAt : null,
    ],
  );
}

describe.skipIf(!process.env.DATABASE_URL)(
  "reservations exclusion constraint (real PostgreSQL)",
  () => {
    it("installs btree_gist", async () => {
      const connection = await freshConnection();
      try {
        const result = await connection.pool.query(
          "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
        );
        expect(result.rows).toHaveLength(1);
      } finally {
        await connection.pool.end();
      }
    });

    it("rejects a second HELD insert that overlaps an existing HELD reservation for the same subject — raw SQL, no application code involved", async () => {
      const connection = await freshConnection();
      try {
        await rawInsertReservation(connection, {
          id: "018e6b3a-9c3e-7000-8000-0000000000b1",
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          state: "HELD",
        });

        await expect(
          rawInsertReservation(connection, {
            id: "018e6b3a-9c3e-7000-8000-0000000000b2",
            startsAt: "2026-10-01T09:30:00.000Z",
            endsAt: "2026-10-01T10:30:00.000Z",
            state: "CONFIRMED",
          }),
        ).rejects.toMatchObject({ code: "23P01" });

        const rows = await connection.db.select().from(pgSchema.reservations);
        expect(rows).toHaveLength(1);
      } finally {
        await connection.pool.end();
      }
    });

    it("allows a back-to-back reservation at the exact boundary — half-open interval [starts_at, ends_at)", async () => {
      const connection = await freshConnection();
      try {
        await rawInsertReservation(connection, {
          id: "018e6b3a-9c3e-7000-8000-0000000000c1",
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          state: "HELD",
        });

        await rawInsertReservation(connection, {
          id: "018e6b3a-9c3e-7000-8000-0000000000c2",
          startsAt: "2026-10-01T10:00:00.000Z",
          endsAt: "2026-10-01T11:00:00.000Z",
          state: "HELD",
        });

        const rows = await connection.db.select().from(pgSchema.reservations);
        expect(rows).toHaveLength(2);
      } finally {
        await connection.pool.end();
      }
    });

    it("does not block on a non-blocking state (CANCELLED) even with an identical overlapping interval", async () => {
      const connection = await freshConnection();
      try {
        await rawInsertReservation(connection, {
          id: "018e6b3a-9c3e-7000-8000-0000000000d1",
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          state: "CANCELLED",
        });

        await rawInsertReservation(connection, {
          id: "018e6b3a-9c3e-7000-8000-0000000000d2",
          startsAt: "2026-10-01T09:00:00.000Z",
          endsAt: "2026-10-01T10:00:00.000Z",
          state: "HELD",
        });

        const rows = await connection.db.select().from(pgSchema.reservations);
        expect(rows).toHaveLength(2);
      } finally {
        await connection.pool.end();
      }
    });
  },
);
