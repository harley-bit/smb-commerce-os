import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { createPgConnection } from "../pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "../migrate.js";
import * as sqliteSchema from "./sqlite.js";
import * as pgSchema from "./pg.js";

const merchant = {
  id: "merchant-1",
  name: "Acme Rentals",
  slug: "acme-rentals",
  status: "ACTIVE" as const,
  defaultCurrency: "USD",
  createdAt: "2026-09-08T00:00:00.000Z",
};

const location = {
  id: "location-1",
  merchantId: "merchant-1",
  name: "Main studio",
  timezone: "UTC",
};

const resource = {
  id: "resource-1",
  merchantId: "merchant-1",
  locationId: "location-1",
  kind: "STAFF" as const,
  name: "Jane the instructor",
  capacity: 1,
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.locations).values(location);
  await connection.db.insert(sqliteSchema.resources).values(resource);
}

describe("reservations table (SQLite)", () => {
  it("applies the reservations migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservations'",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual(["reservations"]);
  });

  it("has the overlap-query index on (merchant_id, subject_type, subject_id, starts_at, ends_at)", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const indexColumns = connection.sqlite
      .prepare("PRAGMA index_info('reservations_subject_interval_idx')")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexColumns).toEqual([
      "merchant_id",
      "subject_type",
      "subject_id",
      "starts_at",
      "ends_at",
    ]);
  });

  it("has the hold-sweeper index on (state, expires_at)", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const indexColumns = connection.sqlite
      .prepare("PRAGMA index_info('reservations_state_expires_idx')")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexColumns).toEqual(["state", "expires_at"]);
  });

  it("round-trips a HELD reservation for a resource", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.reservations).values({
      id: "reservation-1",
      merchantId: "merchant-1",
      orderLineId: null,
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:15:00.000Z",
      createdAt: "2026-10-01T08:45:00.000Z",
    });

    const rows = await connection.db.select().from(sqliteSchema.reservations);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "reservation-1",
        subjectType: "RESOURCE",
        subjectId: "resource-1",
        state: "HELD",
        quantity: 1,
      }),
    ]);
  });

  it("filters to only blocking states (HELD, CONFIRMED, IN_USE), excluding COMPLETED/CANCELLED/EXPIRED", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const states = [
      "HELD",
      "CONFIRMED",
      "IN_USE",
      "COMPLETED",
      "CANCELLED",
      "EXPIRED",
    ] as const;

    for (const [index, state] of states.entries()) {
      await connection.db.insert(sqliteSchema.reservations).values({
        id: `reservation-${index}`,
        merchantId: "merchant-1",
        subjectType: "RESOURCE",
        subjectId: "resource-1",
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state,
        expiresAt: state === "HELD" ? "2026-10-01T09:15:00.000Z" : null,
        createdAt: "2026-10-01T08:45:00.000Z",
      });
    }

    const blockingRows = connection.sqlite
      .prepare(
        "SELECT id, state FROM reservations WHERE state IN ('HELD','CONFIRMED','IN_USE') ORDER BY state",
      )
      .all() as { id: string; state: string }[];

    expect(blockingRows.map((row) => row.state)).toEqual([
      "CONFIRMED",
      "HELD",
      "IN_USE",
    ]);
  });

  it("rejects a reservation referencing a non-existent merchant — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.reservations).values({
        id: "reservation-1",
        merchantId: "does-not-exist",
        subjectType: "RESOURCE",
        subjectId: "resource-1",
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T09:15:00.000Z",
        createdAt: "2026-10-01T08:45:00.000Z",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "reservations table (real PostgreSQL)",
  () => {
    it("applies the migration, round-trips a reservation, and enforces the blocking-state index", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
        await connection.pool.query('CREATE SCHEMA "public"');
        await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

        await runPgMigrations(connection);

        await connection.db.insert(pgSchema.merchants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Acme Rentals",
          slug: "acme-rentals",
          status: "ACTIVE",
          defaultCurrency: "USD",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.locations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000002",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Main studio",
          timezone: "UTC",
        });

        await connection.db.insert(pgSchema.resources).values({
          id: "018e6b3a-9c3e-7000-8000-000000000040",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          locationId: "018e6b3a-9c3e-7000-8000-000000000002",
          kind: "STAFF",
          name: "Jane the instructor",
          capacity: 1,
        });

        await connection.db.insert(pgSchema.reservations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000050",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          subjectType: "RESOURCE",
          subjectId: "018e6b3a-9c3e-7000-8000-000000000040",
          startsAt: new Date("2026-10-01T09:00:00.000Z"),
          endsAt: new Date("2026-10-01T10:00:00.000Z"),
          quantity: 1,
          state: "HELD",
          expiresAt: new Date("2026-10-01T09:15:00.000Z"),
          createdAt: new Date("2026-10-01T08:45:00.000Z"),
        });

        const rows = await connection.db.select().from(pgSchema.reservations);
        expect(rows).toHaveLength(1);

        const indexRows = await connection.pool.query(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'reservations'",
        );
        const indexNames = indexRows.rows.map(
          (row: { indexname: string }) => row.indexname,
        );
        expect(indexNames).toContain("reservations_subject_interval_idx");
        expect(indexNames).toContain("reservations_state_expires_idx");

        await expect(
          connection.db.insert(pgSchema.reservations).values({
            id: "018e6b3a-9c3e-7000-8000-000000000051",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000099",
            subjectType: "RESOURCE",
            subjectId: "018e6b3a-9c3e-7000-8000-000000000040",
            startsAt: new Date("2026-10-01T09:00:00.000Z"),
            endsAt: new Date("2026-10-01T10:00:00.000Z"),
            quantity: 1,
            state: "HELD",
            expiresAt: new Date("2026-10-01T09:15:00.000Z"),
            createdAt: new Date("2026-10-01T08:45:00.000Z"),
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
