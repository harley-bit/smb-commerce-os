import type { Pool } from "pg";
import type { Connection } from "../connection.js";

/**
 * `docs/design/05` "Late returns" — "A rental whose `ends_at` has passed
 * with no `RETURNED` event is overdue. The system does not auto-cancel and
 * does not auto-charge." Step 1 of that section is "Mark the reservation
 * overdue (derived, not a stored state)": overdue is `state = 'IN_USE' AND
 * ends_at < asOf`, computed fresh on every call — there is no `overdue`
 * column and nothing here ever writes to `reservations`. Steps 3-4
 * (downstream conflict detection/alerting) are `D082`; step 5 (late fees)
 * is `D083`.
 */
export interface OverdueReservation {
  id: string;
  merchantId: string;
  orderLineId: string | null;
  customerUserId: string | null;
  subjectType: string;
  subjectId: string;
  endsAt: string;
}

export interface LateReturnDetectionResult {
  overdueReservationIds: string[];
}

/**
 * This card's security check made operational: overdue is a query over
 * existing columns (`reservations.state`, `reservations.ends_at`), never a
 * flag flipped by this job — so there is no persisted state to drift out of
 * sync with reality, and calling this repeatedly (it is intended to run on
 * a schedule, same as `HoldExpirySweeper`) always reflects the current
 * truth rather than a stale snapshot from whenever it last ran.
 */
export type OverdueReservationNotifier = (overdue: OverdueReservation) => void;

export interface LateReturnNotifiers {
  onMerchantNotify?: OverdueReservationNotifier;
  onCustomerNotify?: OverdueReservationNotifier;
}

const SELECT_OVERDUE_SQLITE = `
  SELECT r.id, r.merchant_id, r.order_line_id, r.subject_type, r.subject_id, r.ends_at, o.customer_user_id
    FROM reservations r
    LEFT JOIN order_lines ol ON ol.id = r.order_line_id
    LEFT JOIN orders o ON o.id = ol.order_id
   WHERE r.state = 'IN_USE'
     AND r.ends_at < ?
`;

function notifyAll(candidates: OverdueReservation[], notifiers?: LateReturnNotifiers): void {
  for (const candidate of candidates) {
    notifiers?.onMerchantNotify?.(candidate);
    notifiers?.onCustomerNotify?.(candidate);
  }
}

/**
 * Read-only: no `UPDATE` statement exists in this function. Intended to run
 * on a schedule alongside `HoldExpirySweeper`/`DepositAutoReleaseJob`, but
 * unlike those, a second run is not just idempotent — it is expected to
 * keep re-reporting the same overdue reservation on every call until an
 * actual `RETURNED` event (a later card) changes `reservations.state`,
 * because there is nothing here to mark "already notified".
 */
export function detectOverdueReservationsSqlite(
  conn: Connection,
  asOf: string,
  notifiers?: LateReturnNotifiers,
): LateReturnDetectionResult {
  const rows = conn.sqlite.prepare(SELECT_OVERDUE_SQLITE).all(asOf) as Array<{
    id: string;
    merchant_id: string;
    order_line_id: string | null;
    subject_type: string;
    subject_id: string;
    ends_at: string;
    customer_user_id: string | null;
  }>;

  const candidates: OverdueReservation[] = rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    endsAt: row.ends_at,
  }));

  notifyAll(candidates, notifiers);
  return { overdueReservationIds: candidates.map((c) => c.id) };
}

/** PostgreSQL side of the same read-only detection query. */
export async function detectOverdueReservationsPg(
  pool: Pool,
  asOf: string,
  notifiers?: LateReturnNotifiers,
): Promise<LateReturnDetectionResult> {
  const result = await pool.query<{
    id: string;
    merchant_id: string;
    order_line_id: string | null;
    subject_type: string;
    subject_id: string;
    ends_at: string;
    customer_user_id: string | null;
  }>(
    `SELECT r.id, r.merchant_id, r.order_line_id, r.subject_type, r.subject_id, r.ends_at, o.customer_user_id
       FROM reservations r
       LEFT JOIN order_lines ol ON ol.id = r.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
      WHERE r.state = 'IN_USE'
        AND r.ends_at < $1`,
    [asOf],
  );

  const candidates: OverdueReservation[] = result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    endsAt: row.ends_at,
  }));

  notifyAll(candidates, notifiers);
  return { overdueReservationIds: candidates.map((c) => c.id) };
}
