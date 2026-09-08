import { describe, expect, it } from "vitest";
import { createPgConnection, type PgConnection } from "../pg-connection.js";
import { runPgMigrations } from "../migrate.js";
import * as pgSchema from "../schema/pg.js";

/**
 * D053 — the PostgreSQL half of Gate G3's core, never-waivable test: N=50
 * genuinely parallel *identical* reservation inserts (same subject, same
 * exact interval), each on its own real `pg.Pool` connection, racing D051's
 * exclusion constraint. Same real-multi-connection mechanics as D052's
 * harness — this card raises N to 50 and asserts only the production
 * (constraint-in-place) arm, since D052 already proved the
 * constraint-dropped arm demonstrably races.
 */
const merchantId = "018e6b3a-9c3e-7000-8000-0000000000f1";
const locationId = "018e6b3a-9c3e-7000-8000-0000000000f2";
const resourceId = "018e6b3a-9c3e-7000-8000-0000000000f3";

const ATTEMPTS = 50;
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
    slug: "race-merchant-identical",
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
  const attempts = Array.from({ length: ATTEMPTS }, (_, i) =>
    (async (): Promise<RaceResult> => {
      const client = await connection.pool.connect();
      try {
        await client.query(
          `INSERT INTO reservations
             (id, merchant_id, subject_type, subject_id, starts_at, ends_at, quantity, state, expires_at, created_at)
           VALUES ($1, $2, 'RESOURCE', $3, $4, $5, 1, 'CONFIRMED', NULL, now())`,
          [
            `018e6b3a-9c3e-7000-8000-0000000002${String(i).padStart(2, "0")}`,
            merchantId,
            resourceId,
            startsAt,
            endsAt,
          ],
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
  "ReservationRepository — N=50 identical-request race (D053, Gate G3, real PostgreSQL)",
  () => {
    it(
      "50 real concurrent connections inserting the identical reservation resolve to exactly one winner",
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
      60_000,
    );
  },
);
