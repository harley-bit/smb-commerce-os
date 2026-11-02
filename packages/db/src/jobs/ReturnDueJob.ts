import type { Pool } from "pg";
import type { Connection } from "../connection.js";

/**
 * `docs/cards/D134.md` deliverable "return-due" — the not-yet-overdue
 * complement to `LateReturnDetector.ts`: that job only fires once `ends_at`
 * has already passed; this one fires while an `IN_USE` rental's `ends_at`
 * is still ahead but approaching, so a customer gets a heads-up before they
 * become late rather than only after. Same read-only, re-derived-on-every-
 * call posture as every other job in this file's family — no persisted
 * "already reminded" flag.
 */
export interface ReturnDueReservation {
  id: string;
  merchantId: string;
  orderLineId: string | null;
  customerUserId: string | null;
  subjectType: string;
  subjectId: string;
  endsAt: string;
}

export interface ReturnDueResult {
  returnDueReservationIds: string[];
}

export type ReturnDueNotifier = (dueSoon: ReturnDueReservation) => void;

export interface ReturnDueNotifiers {
  onCustomerNotify?: ReturnDueNotifier;
}

const SELECT_DUE_SOON_SQLITE = `
  SELECT r.id, r.merchant_id, r.order_line_id, r.subject_type, r.subject_id, r.ends_at, o.customer_user_id
    FROM reservations r
    LEFT JOIN order_lines ol ON ol.id = r.order_line_id
    LEFT JOIN orders o ON o.id = ol.order_id
   WHERE r.state = 'IN_USE'
     AND r.ends_at >= ?
     AND r.ends_at <= ?
`;

function notifyAll(candidates: ReturnDueReservation[], notifiers?: ReturnDueNotifiers): void {
  for (const candidate of candidates) {
    notifiers?.onCustomerNotify?.(candidate);
  }
}

/**
 * Intended to run on a schedule alongside `LateReturnDetector`. `windowHours`
 * is the caller's own "how far ahead to warn" choice, same open judgment
 * call as `ReservationReminderJob`'s.
 */
export function detectReturnsDueSqlite(
  conn: Connection,
  asOf: string,
  windowHours: number,
  notifiers?: ReturnDueNotifiers,
): ReturnDueResult {
  const windowEnd = new Date(new Date(asOf).getTime() + windowHours * 60 * 60 * 1000).toISOString();

  const rows = conn.sqlite.prepare(SELECT_DUE_SOON_SQLITE).all(asOf, windowEnd) as Array<{
    id: string;
    merchant_id: string;
    order_line_id: string | null;
    subject_type: string;
    subject_id: string;
    ends_at: string;
    customer_user_id: string | null;
  }>;

  const candidates: ReturnDueReservation[] = rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    endsAt: row.ends_at,
  }));

  notifyAll(candidates, notifiers);
  return { returnDueReservationIds: candidates.map((c) => c.id) };
}

/** PostgreSQL side of the same read-only detection query. */
export async function detectReturnsDuePg(
  pool: Pool,
  asOf: string,
  windowHours: number,
  notifiers?: ReturnDueNotifiers,
): Promise<ReturnDueResult> {
  const windowEnd = new Date(new Date(asOf).getTime() + windowHours * 60 * 60 * 1000).toISOString();

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
        AND r.ends_at >= $1
        AND r.ends_at <= $2`,
    [asOf, windowEnd],
  );

  const candidates: ReturnDueReservation[] = result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    endsAt: row.ends_at,
  }));

  notifyAll(candidates, notifiers);
  return { returnDueReservationIds: candidates.map((c) => c.id) };
}
