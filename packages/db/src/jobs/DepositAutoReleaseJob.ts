import type { Pool } from "pg";
import type { Connection } from "../connection.js";

/**
 * `docs/design/05` "Hold expiry and the sweeper" — the deposit-side
 * complement to `HoldExpirySweeper` (D062): "A scheduled job releases holds
 * whose rental has completed with no claim filed, before expiry. Never let
 * a hold silently expire on a customer's card; release it deliberately and
 * notify." `HoldExpirySweeper` reacts to a *reservation* hold expiring
 * before fulfillment; this job reacts to a rental actually finishing —
 * signaled by a `CHECKIN` condition report (`docs/design/03`, D075) — with
 * no damage claim ever filed against the order line. It never touches a
 * deposit whose rental hasn't checked in yet, or one with any claim on
 * file, filed or resolved (D076's `damage_claims`).
 */
export interface DepositReleaseCandidate {
  id: string;
  merchantId: string;
  orderLineId: string;
  amountMinor: number;
  currency: string;
}

export interface DepositAutoReleaseResult {
  releasedDepositAuthorizationIds: string[];
}

/**
 * This card's security check made operational: fired once per deposit
 * actually released, so a customer is told every time this job moves money
 * off their card — never a silent lapse. Same optional, default-no-op
 * injected-callback shape as `DamageClaimCustomerNotifier` (D076) and
 * `FutureReservationCancelledNotifier` (D069).
 */
export type DepositReleaseCustomerNotifier = (candidate: DepositReleaseCandidate) => void;

const SELECT_RELEASABLE_SQLITE = `
  SELECT da.id, da.merchant_id, da.order_line_id, da.amount_minor, da.currency
    FROM deposit_authorizations da
   WHERE da.state = 'AUTHORIZED'
     AND EXISTS (
       SELECT 1 FROM condition_reports cr
        WHERE cr.order_line_id = da.order_line_id AND cr.phase = 'CHECKIN'
     )
     AND NOT EXISTS (
       SELECT 1 FROM damage_claims dc WHERE dc.order_line_id = da.order_line_id
     )
`;

/**
 * Intended to run on a schedule (e.g. every few minutes), well ahead of any
 * realistic `expires_at`, alongside `sweepExpiredHoldsSqlite`. Idempotent
 * and safe under concurrent invocation: `BEGIN IMMEDIATE` serializes
 * concurrent calls the same way `HoldExpirySweeper` does, so a second
 * concurrent run re-reads the now-`RELEASED` rows and finds nothing left to
 * release.
 */
export function releaseCompletedDepositsSqlite(
  conn: Connection,
  onReleased?: DepositReleaseCustomerNotifier,
): DepositAutoReleaseResult {
  const attempt = conn.sqlite.transaction((): DepositReleaseCandidate[] => {
    const rows = conn.sqlite.prepare(SELECT_RELEASABLE_SQLITE).all() as Array<{
      id: string;
      merchant_id: string;
      order_line_id: string;
      amount_minor: number;
      currency: string;
    }>;

    if (rows.length === 0) {
      return [];
    }

    const releasedAt = new Date().toISOString();
    const update = conn.sqlite.prepare(
      `UPDATE deposit_authorizations SET state = 'RELEASED', released_at = ? WHERE id = ? AND state = 'AUTHORIZED'`,
    );
    for (const row of rows) {
      update.run(releasedAt, row.id);
    }

    return rows.map((row) => ({
      id: row.id,
      merchantId: row.merchant_id,
      orderLineId: row.order_line_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
    }));
  });

  const candidates = attempt.immediate();
  for (const candidate of candidates) {
    onReleased?.(candidate);
  }
  return { releasedDepositAuthorizationIds: candidates.map((c) => c.id) };
}

/**
 * PostgreSQL side of the same job. `SELECT ... FOR UPDATE SKIP LOCKED`
 * inside a transaction, same lock discipline the design doc's sweeper
 * section calls for, so two concurrent runs never both try to release the
 * same row: the loser skips whatever the winner already locked and, once
 * the winner commits, finds nothing left in `AUTHORIZED` state to act on.
 */
export async function releaseCompletedDepositsPg(
  pool: Pool,
  onReleased?: DepositReleaseCustomerNotifier,
): Promise<DepositAutoReleaseResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const selectResult = await client.query<{
      id: string;
      merchant_id: string;
      order_line_id: string;
      amount_minor: number;
      currency: string;
    }>(
      `SELECT da.id, da.merchant_id, da.order_line_id, da.amount_minor, da.currency
         FROM deposit_authorizations da
        WHERE da.state = 'AUTHORIZED'
          AND EXISTS (
            SELECT 1 FROM condition_reports cr
             WHERE cr.order_line_id = da.order_line_id AND cr.phase = 'CHECKIN'
          )
          AND NOT EXISTS (
            SELECT 1 FROM damage_claims dc WHERE dc.order_line_id = da.order_line_id
          )
        FOR UPDATE SKIP LOCKED`,
    );

    const candidates: DepositReleaseCandidate[] = selectResult.rows.map((row) => ({
      id: row.id,
      merchantId: row.merchant_id,
      orderLineId: row.order_line_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
    }));

    if (candidates.length > 0) {
      await client.query(
        `UPDATE deposit_authorizations SET state = 'RELEASED', released_at = now()
          WHERE id = ANY($1::uuid[]) AND state = 'AUTHORIZED'`,
        [candidates.map((c) => c.id)],
      );
    }

    await client.query("COMMIT");

    for (const candidate of candidates) {
      onReleased?.(candidate);
    }
    return { releasedDepositAuthorizationIds: candidates.map((c) => c.id) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
