import { describe, expect, it } from "vitest";
import { createPgConnection, type PgConnection } from "../pg-connection.js";
import { runPgMigrations } from "../migrate.js";
import * as pgSchema from "../schema/pg.js";

/**
 * D052 — the PostgreSQL half of the concurrency test harness. Unlike the
 * SQLite side (`ReservationRepository.concurrency.test.ts`, real
 * `worker_threads`), genuine parallelism here doesn't need extra threads:
 * `pg.Pool` gives each attempt its own real TCP connection and its own
 * backend process on the server, so `Promise.all` over `ATTEMPTS` raw
 * inserts is a real concurrent multi-connection race against the database
 * engine, not a same-thread simulation — the same "actually concurrent, not
 * mocked timing" bar `docs/design/05` and this card's security check set.
 *
 * The acceptance criterion ("harness demonstrably races — fails without the
 * fix") is proven by the first test: with D051's exclusion constraint
 * dropped, real concurrent overlapping inserts for the same subject all
 * succeed — an actual double-booking. The second test proves the harness
 * isn't rigged: with the constraint restored, the identical race yields
 * exactly one winner and the rest fail with PostgreSQL's own `23P01`.
 *
 * `docs/cards/D054.md` narrowed the exclusion constraint (migration 0011) to
 * `INVENTORY_UNIT` subjects only (see `PgReservationRepository.test.ts` for
 * the equivalent `RESOURCE`/capacity-checked proof) — this file's subject is
 * switched to `INVENTORY_UNIT` so it keeps proving the constraint itself.
 */
const merchantId = "018e6b3a-9c3e-7000-8000-0000000000e1";
const locationId = "018e6b3a-9c3e-7000-8000-0000000000e2";
const resourceId = "018e6b3a-9c3e-7000-8000-0000000000e3";

const ATTEMPTS = 10;
const startsAt = "2026-10-01T09:00:00.000Z";
const endsAt = "2026-10-01T10:00:00.000Z";

async function freshConnection(): Promise<PgConnection> {
  const connectionString = process.env.DATABASE_URL as string;
  const connection = createPgConnection(connectionString);

  await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
  await connection.pool.query('CREATE SCHEMA "public"');
  await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
  await runPgMigrations(connection);

  await connection.db.insert(pgSchema.merchants).values({
    id: merchantId,
    name: "Race Merchant",
    slug: "race-merchant",
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

interface RaceResult {
  ok: boolean;
  code?: string;
}

async function race(connection: PgConnection): Promise<RaceResult[]> {
  // Each attempt gets its own dedicated client from the pool (not the shared
  // `pool.query` helper, which would hand connections back after each call)
  // so all `ATTEMPTS` real connections are open and inserting at once.
  const attempts = Array.from({ length: ATTEMPTS }, (_, i) =>
    (async (): Promise<RaceResult> => {
      const client = await connection.pool.connect();
      try {
        await client.query(
          `INSERT INTO reservations
             (id, merchant_id, subject_type, subject_id, starts_at, ends_at, quantity, state, expires_at, created_at)
           VALUES ($1, $2, 'INVENTORY_UNIT', $3, $4, $5, 1, 'CONFIRMED', NULL, now())`,
          [`018e6b3a-9c3e-7000-8000-0000000001${String(i).padStart(2, "0")}`, merchantId, resourceId, startsAt, endsAt],
        );
        return { ok: true };
      } catch (err) {
        return { ok: false, code: (err as { code?: string }).code };
      } finally {
        client.release();
      }
    })(),
  );

  return Promise.all(attempts);
}

describe.skipIf(!process.env.DATABASE_URL)(
  "ReservationRepository — concurrency harness (D052, real PostgreSQL parallel connections)",
  () => {
    it(
      "with the exclusion constraint dropped, real concurrent overlapping inserts all succeed — the harness demonstrably races without the fix",
      async () => {
        const connection = await freshConnection();
        try {
          await connection.pool.query(
            "ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap",
          );

          const results = await race(connection);
          const succeeded = results.filter((r) => r.ok);

          // If this were ever exactly 1, the constraint would still be
          // enforcing something, or the attempts weren't actually
          // concurrent — either way, this arm of the harness would not be
          // proving what it claims to.
          expect(succeeded.length).toBeGreaterThan(1);

          const rows = await connection.db.select().from(pgSchema.reservations);
          expect(rows).toHaveLength(succeeded.length);
          expect(rows.length).toBeGreaterThan(1);
        } finally {
          await connection.pool.end();
        }
      },
      30_000,
    );

    it(
      "with the exclusion constraint in place, the identical real concurrent race resolves to exactly one winner",
      async () => {
        const connection = await freshConnection();
        try {
          const results = await race(connection);
          const succeeded = results.filter((r) => r.ok);
          const failed = results.filter((r) => !r.ok);

          expect(succeeded).toHaveLength(1);
          expect(failed).toHaveLength(ATTEMPTS - 1);
          for (const failure of failed) {
            expect(failure.code).toBe("23P01");
          }

          const rows = await connection.db.select().from(pgSchema.reservations);
          expect(rows).toHaveLength(1);
        } finally {
          await connection.pool.end();
        }
      },
      30_000,
    );
  },
);
