import type { Pool } from "pg";
import { generateUuidV7, type TenantContext } from "@smb-os/domain";
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
    input: CreateReservationInput,
    capacity = 1,
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Row lock on the resource — serializes concurrent bookings for this
      // resource. Missing row (bad subjectId) is a caller error, not a
      // capacity question, so it's allowed to fall through to whatever the
      // insert's own constraints report.
      await client.query('SELECT id FROM "resources" WHERE id = $1 AND merchant_id = $2 FOR UPDATE', [
        input.subjectId,
        ctx.merchantId,
      ]);

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
           (id, merchant_id, order_line_id, subject_type, subject_id, starts_at, ends_at, quantity, state, expires_at, created_at, released_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
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
