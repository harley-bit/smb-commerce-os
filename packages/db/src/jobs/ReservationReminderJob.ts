import type { Pool } from "pg";
import type { Connection } from "../connection.js";

/**
 * `docs/cards/D134.md` deliverable "reminder" — the confirmation-side
 * complement to `ReturnDueJob.ts`: this job reacts to a `CONFIRMED`
 * reservation's own `starts_at` approaching, so a customer gets a heads-up
 * before a service appointment or rental pickup, not just a confirmation at
 * booking time. Read-only, same "re-derived on every call" posture as
 * `LateReturnDetector` — there is no persisted "already reminded" flag, so a
 * caller on a schedule is expected to run this against a narrow, moving
 * window (e.g. "starts within the next N hours") to avoid re-notifying the
 * same reservation on every run in production; the window boundary itself
 * is exercised directly by this job's own tests.
 */
export interface UpcomingReservation {
  id: string;
  merchantId: string;
  orderLineId: string | null;
  customerUserId: string | null;
  subjectType: string;
  subjectId: string;
  startsAt: string;
}

export interface ReservationReminderResult {
  upcomingReservationIds: string[];
}

export type UpcomingReservationNotifier = (upcoming: UpcomingReservation) => void;

export interface ReservationReminderNotifiers {
  onCustomerNotify?: UpcomingReservationNotifier;
}

const SELECT_UPCOMING_SQLITE = `
  SELECT r.id, r.merchant_id, r.order_line_id, r.subject_type, r.subject_id, r.starts_at, o.customer_user_id
    FROM reservations r
    LEFT JOIN order_lines ol ON ol.id = r.order_line_id
    LEFT JOIN orders o ON o.id = ol.order_id
   WHERE r.state = 'CONFIRMED'
     AND r.starts_at >= ?
     AND r.starts_at <= ?
`;

function notifyAll(candidates: UpcomingReservation[], notifiers?: ReservationReminderNotifiers): void {
  for (const candidate of candidates) {
    notifiers?.onCustomerNotify?.(candidate);
  }
}

/**
 * Intended to run on a schedule alongside `HoldExpirySweeper`/
 * `DepositAutoReleaseJob`/`LateReturnDetector`. `windowHours` is the
 * caller's own "how far ahead to remind" choice — no design doc mandates a
 * specific figure, same open-judgment-call posture as D119's
 * `DEPOSIT_EXPIRING_SOON_WINDOW_HOURS`.
 */
export function detectUpcomingReservationsSqlite(
  conn: Connection,
  asOf: string,
  windowHours: number,
  notifiers?: ReservationReminderNotifiers,
): ReservationReminderResult {
  const windowEnd = new Date(new Date(asOf).getTime() + windowHours * 60 * 60 * 1000).toISOString();

  const rows = conn.sqlite.prepare(SELECT_UPCOMING_SQLITE).all(asOf, windowEnd) as Array<{
    id: string;
    merchant_id: string;
    order_line_id: string | null;
    subject_type: string;
    subject_id: string;
    starts_at: string;
    customer_user_id: string | null;
  }>;

  const candidates: UpcomingReservation[] = rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    startsAt: row.starts_at,
  }));

  notifyAll(candidates, notifiers);
  return { upcomingReservationIds: candidates.map((c) => c.id) };
}

/** PostgreSQL side of the same read-only detection query. */
export async function detectUpcomingReservationsPg(
  pool: Pool,
  asOf: string,
  windowHours: number,
  notifiers?: ReservationReminderNotifiers,
): Promise<ReservationReminderResult> {
  const windowEnd = new Date(new Date(asOf).getTime() + windowHours * 60 * 60 * 1000).toISOString();

  const result = await pool.query<{
    id: string;
    merchant_id: string;
    order_line_id: string | null;
    subject_type: string;
    subject_id: string;
    starts_at: string;
    customer_user_id: string | null;
  }>(
    `SELECT r.id, r.merchant_id, r.order_line_id, r.subject_type, r.subject_id, r.starts_at, o.customer_user_id
       FROM reservations r
       LEFT JOIN order_lines ol ON ol.id = r.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
      WHERE r.state = 'CONFIRMED'
        AND r.starts_at >= $1
        AND r.starts_at <= $2`,
    [asOf, windowEnd],
  );

  const candidates: UpcomingReservation[] = result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    orderLineId: row.order_line_id,
    customerUserId: row.customer_user_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    startsAt: row.starts_at,
  }));

  notifyAll(candidates, notifiers);
  return { upcomingReservationIds: candidates.map((c) => c.id) };
}
