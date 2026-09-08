import type { Pool } from "pg";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { depositAuthorizations, reservations } from "../schema/sqlite.js";

/**
 * `docs/design/05` "Hold expiry and the sweeper" — the *active* half of the
 * belt-and-braces pair. The *lazy* half (every overlap query and
 * `createGuarded`'s own eager per-subject expiry, D049/D050/D056) already
 * guarantees an unswept expired hold never blocks a new reservation; this
 * job exists purely to keep `reservations.state` truthful and to release
 * the customer's money promptly rather than leaving an authorization to
 * lapse silently on their card (this card's security check).
 */
export interface SweepResult {
  expiredReservationIds: string[];
  releasedDepositAuthorizationIds: string[];
}

/**
 * Runs every minute per the design doc; must be safe to run concurrently
 * with itself. `BEGIN IMMEDIATE` (same lock discipline as
 * `ReservationRepository.createGuarded`) makes a second concurrent call
 * block until the first commits, then re-read the now-updated rows — so it
 * finds nothing left to expire and returns an empty result. That's what
 * makes this idempotent under real concurrency, not just on paper: calling
 * it twice, or from N racing callers, expires each hold and releases each
 * deposit authorization exactly once.
 */
export function sweepExpiredHoldsSqlite(conn: Connection, asOf: string): SweepResult {
  const attempt = conn.sqlite.transaction((): SweepResult => {
    const expiredRows = conn.db
      .select({ id: reservations.id, orderLineId: reservations.orderLineId })
      .from(reservations)
      .where(
        and(eq(reservations.state, "HELD"), isNotNull(reservations.expiresAt), lte(reservations.expiresAt, asOf)),
      )
      .all();

    if (expiredRows.length === 0) {
      return { expiredReservationIds: [], releasedDepositAuthorizationIds: [] };
    }

    const expiredReservationIds = expiredRows.map((row) => row.id);
    conn.db
      .update(reservations)
      .set({ state: "EXPIRED", releasedAt: asOf })
      .where(inArray(reservations.id, expiredReservationIds))
      .run();

    const orderLineIds = [
      ...new Set(expiredRows.map((row) => row.orderLineId).filter((id): id is string => id !== null)),
    ];

    let releasedDepositAuthorizationIds: string[] = [];
    if (orderLineIds.length > 0) {
      const depositRows = conn.db
        .select({ id: depositAuthorizations.id })
        .from(depositAuthorizations)
        .where(
          and(eq(depositAuthorizations.state, "AUTHORIZED"), inArray(depositAuthorizations.orderLineId, orderLineIds)),
        )
        .all();

      if (depositRows.length > 0) {
        releasedDepositAuthorizationIds = depositRows.map((row) => row.id);
        conn.db
          .update(depositAuthorizations)
          .set({ state: "RELEASED", releasedAt: asOf })
          .where(inArray(depositAuthorizations.id, releasedDepositAuthorizationIds))
          .run();
      }
    }

    return { expiredReservationIds, releasedDepositAuthorizationIds };
  });

  return attempt.immediate();
}

/**
 * PostgreSQL side of the same job. No `SELECT ... FOR UPDATE` is needed the
 * way `PgReservationRepository.createGuarded` needs one for admission: a
 * single `UPDATE ... WHERE state = 'HELD' AND expires_at <= $1` is already
 * atomic per row under PostgreSQL's default READ COMMITTED isolation — two
 * concurrent transactions racing the same row serialize on that row's lock,
 * and the loser's `WHERE` re-evaluates against the winner's committed
 * update, so it matches zero rows instead of double-expiring anything.
 */
export async function sweepExpiredHoldsPg(pool: Pool, asOf: string): Promise<SweepResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const expiredResult = await client.query<{ id: string; order_line_id: string | null }>(
      `UPDATE "reservations"
          SET state = 'EXPIRED', released_at = $1
        WHERE state = 'HELD'
          AND expires_at IS NOT NULL
          AND expires_at <= $1
        RETURNING id, order_line_id`,
      [asOf],
    );
    const expiredReservationIds = expiredResult.rows.map((row) => row.id);

    const orderLineIds = [
      ...new Set(expiredResult.rows.map((row) => row.order_line_id).filter((id): id is string => id !== null)),
    ];

    let releasedDepositAuthorizationIds: string[] = [];
    if (orderLineIds.length > 0) {
      const depositResult = await client.query<{ id: string }>(
        `UPDATE "deposit_authorizations"
            SET state = 'RELEASED', released_at = $1
          WHERE state = 'AUTHORIZED'
            AND order_line_id = ANY($2::uuid[])
          RETURNING id`,
        [asOf, orderLineIds],
      );
      releasedDepositAuthorizationIds = depositResult.rows.map((row) => row.id);
    }

    await client.query("COMMIT");
    return { expiredReservationIds, releasedDepositAuthorizationIds };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
