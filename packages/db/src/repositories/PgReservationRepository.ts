import type { Pool } from "pg";
import { expandIntervalForBuffer, generateUuidV7, type TenantContext } from "@smb-os/domain";
import {
  ReservationConflictError,
  type CreateReservationInput,
} from "./ReservationRepository.js";

/**
 * `docs/design/05` "Fungible capacity" / `docs/cards/D054.md` — the
 * PostgreSQL capacity-checked write path. Migration 0011 narrowed the
 * `reservations_no_overlap` exclusion constraint (D051) to `INVENTORY_UNIT`
 * subjects only, because an exclusion constraint cannot express "sum of
 * overlapping quantities <= capacity". `RESOURCE` subjects — `capacity = 1`
 * included, since that's just this check's boundary case — are guarded here
 * instead: `SELECT ... FOR UPDATE` on the `resources` row is taken first,
 * inside a single transaction, so a second concurrent caller for the same
 * resource cannot proceed past that lock until the first commits or rolls
 * back — the same serialization role D050's `BEGIN IMMEDIATE` plays for
 * SQLite. Only once that lock is held does the sum-of-overlapping-quantity
 * check run, so it is always evaluated against fully-committed data.
 */
export class PgReservationRepository {
  constructor(private readonly pool: Pool) {}

  async createGuarded(
    ctx: TenantContext,
    rawInput: CreateReservationInput,
    capacity = 1,
  ): Promise<string> {
    // `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — expand
    // the requested `endsAt` by `bufferMinutes` before the overlap check and
    // the insert, and snapshot `bufferMinutes` onto the row, same as
    // `ReservationRepository.createGuarded` (SQLite).
    const expanded = expandIntervalForBuffer(rawInput.startsAt, rawInput.endsAt, rawInput.bufferMinutes);
    const input: CreateReservationInput = {
      ...rawInput,
      startsAt: expanded.startsAt,
      endsAt: expanded.endsAt,
      bufferMinutes: rawInput.bufferMinutes ?? null,
    };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // `docs/cards/D059.md` security check — Idempotency-Key required on
      // creation. A retry carrying the same key short-circuits to the
      // already-created row rather than re-running the conflict check, same
      // behavior as `ReservationRepository.createGuarded` (SQLite).
      if (input.idempotencyKey) {
        const existingResult = await client.query<{ id: string }>(
          `SELECT id FROM "reservations" WHERE merchant_id = $1 AND idempotency_key = $2`,
          [ctx.merchantId, input.idempotencyKey],
        );
        const existingId = existingResult.rows[0]?.id;
        if (existingId) {
          await client.query("COMMIT");
          return existingId;
        }
      }

      // Row lock on the resource — serializes concurrent bookings for this
      // resource. Missing row (bad subjectId) is a caller error, not a
      // capacity question, so it's allowed to fall through to whatever the
      // insert's own constraints report.
      await client.query('SELECT id FROM "resources" WHERE id = $1 AND merchant_id = $2 FOR UPDATE', [
        input.subjectId,
        ctx.merchantId,
      ]);

      // `docs/cards/D056.md` — the exclusion constraint's WHERE clause
      // (migration 0011) is a static index predicate; it cannot compare
      // `expires_at` against "now" the way `findBlocking`/the sum query
      // below do, so an unswept expired HELD row would otherwise still
      // trip it on the INSERT below. Closing exactly those rows (never
      // active ones — the predicate only matches already-expired holds)
      // here, inside the same transaction, keeps the write path correct
      // independent of whether a background sweeper has run yet.
      await client.query(
        `UPDATE "reservations"
            SET state = 'EXPIRED', released_at = $1
          WHERE merchant_id = $2
            AND subject_type = $3
            AND subject_id = $4
            AND state = 'HELD'
            AND expires_at <= $1`,
        [input.createdAt, ctx.merchantId, input.subjectType, input.subjectId],
      );

      const sumResult = await client.query<{ used: string }>(
        `SELECT COALESCE(SUM(quantity), 0) AS used
           FROM "reservations"
          WHERE merchant_id = $1
            AND subject_type = $2
            AND subject_id = $3
            AND starts_at < $4
            AND ends_at > $5
            AND (state IN ('CONFIRMED', 'IN_USE') OR (state = 'HELD' AND expires_at > $6))`,
        [ctx.merchantId, input.subjectType, input.subjectId, input.endsAt, input.startsAt, input.createdAt],
      );
      const used = Number(sumResult.rows[0]?.used ?? 0);

      if (used + input.quantity > capacity) {
        await client.query("ROLLBACK");
        throw new ReservationConflictError(input.subjectType, input.subjectId);
      }

      const id = generateUuidV7();
      await client.query(
        `INSERT INTO "reservations"
           (id, merchant_id, order_line_id, subject_type, subject_id, starts_at, ends_at, quantity, state, expires_at, created_at, released_at, idempotency_key, created_by_account_id, created_by_ip, buffer_minutes)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, $13, $14)`,
        [
          id,
          ctx.merchantId,
          input.subjectType,
          input.subjectId,
          input.startsAt,
          input.endsAt,
          input.quantity,
          input.state,
          input.expiresAt ?? null,
          input.createdAt,
          input.idempotencyKey ?? null,
          input.createdByAccountId ?? null,
          input.createdByIp ?? null,
          input.bufferMinutes ?? null,
        ],
      );

      await client.query("COMMIT");
      return id;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
