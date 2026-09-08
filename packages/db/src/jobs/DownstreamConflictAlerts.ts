import type { Pool } from "pg";
import type { Connection } from "../connection.js";

/**
 * `docs/design/05` "Late returns", steps 3-4: "Detect downstream conflicts —
 * reservations on the same unit starting soon. Alert the merchant with a
 * specific list of affected bookings and contact details." Step 1-2 (overdue
 * detection/notification) is `D081`'s `LateReturnDetector`; step 5 (late
 * fees) is `D083`.
 *
 * A late return is not just a billing event, it is a **future double-booking
 * that has already happened**: the overdue unit is still out, so any HELD or
 * CONFIRMED reservation on the same subject that hasn't started yet is a
 * conflict the merchant needs to resolve *now*, not once the fee is applied.
 */
export interface DownstreamConflictAlert {
  overdueReservationId: string;
  overdueEndsAt: string;
  subjectType: string;
  subjectId: string;
  affectedReservationId: string;
  affectedStartsAt: string;
  affectedCustomerUserId: string | null;
  affectedContactEmail: string | null;
}

export interface DownstreamConflictDetectionResult {
  alerts: DownstreamConflictAlert[];
}

export type DownstreamConflictAlertHandler = (alert: DownstreamConflictAlert) => void;

export interface DownstreamConflictNotifiers {
  onConflictAlert?: DownstreamConflictAlertHandler;
}

/**
 * Every future reservation still `HELD`/`CONFIRMED` on the same subject as
 * an overdue (`IN_USE`, `ends_at` passed) reservation is a real conflict,
 * one alert per affected booking — never collapsed into a single "unit N is
 * overdue" notice, since the acceptance criteria is that the merchant learns
 * exactly which booking and which customer to call.
 */
const SELECT_CONFLICTS_SQLITE = `
  SELECT
    overdue.id AS overdue_id,
    overdue.ends_at AS overdue_ends_at,
    overdue.subject_type AS subject_type,
    overdue.subject_id AS subject_id,
    affected.id AS affected_id,
    affected.starts_at AS affected_starts_at,
    au.id AS affected_customer_user_id,
    au.email AS affected_contact_email
  FROM reservations overdue
  JOIN reservations affected
    ON affected.merchant_id = overdue.merchant_id
   AND affected.subject_type = overdue.subject_type
   AND affected.subject_id = overdue.subject_id
   AND affected.id != overdue.id
   AND affected.state IN ('HELD', 'CONFIRMED')
   AND affected.starts_at > ?
  LEFT JOIN order_lines ol ON ol.id = affected.order_line_id
  LEFT JOIN orders o ON o.id = ol.order_id
  LEFT JOIN users au ON au.id = o.customer_user_id
  WHERE overdue.state = 'IN_USE'
    AND overdue.ends_at < ?
  ORDER BY affected.starts_at ASC
`;

function notifyAll(alerts: DownstreamConflictAlert[], notifiers?: DownstreamConflictNotifiers): void {
  for (const alert of alerts) {
    notifiers?.onConflictAlert?.(alert);
  }
}

/** Read-only: no `UPDATE` statement exists in this function. */
export function detectDownstreamConflictsSqlite(
  conn: Connection,
  asOf: string,
  notifiers?: DownstreamConflictNotifiers,
): DownstreamConflictDetectionResult {
  const rows = conn.sqlite.prepare(SELECT_CONFLICTS_SQLITE).all(asOf, asOf) as Array<{
    overdue_id: string;
    overdue_ends_at: string;
    subject_type: string;
    subject_id: string;
    affected_id: string;
    affected_starts_at: string;
    affected_customer_user_id: string | null;
    affected_contact_email: string | null;
  }>;

  const alerts: DownstreamConflictAlert[] = rows.map((row) => ({
    overdueReservationId: row.overdue_id,
    overdueEndsAt: row.overdue_ends_at,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    affectedReservationId: row.affected_id,
    affectedStartsAt: row.affected_starts_at,
    affectedCustomerUserId: row.affected_customer_user_id,
    affectedContactEmail: row.affected_contact_email,
  }));

  notifyAll(alerts, notifiers);
  return { alerts };
}

/** PostgreSQL side of the same read-only conflict-detection query. */
export async function detectDownstreamConflictsPg(
  pool: Pool,
  asOf: string,
  notifiers?: DownstreamConflictNotifiers,
): Promise<DownstreamConflictDetectionResult> {
  const result = await pool.query<{
    overdue_id: string;
    overdue_ends_at: string;
    subject_type: string;
    subject_id: string;
    affected_id: string;
    affected_starts_at: string;
    affected_customer_user_id: string | null;
    affected_contact_email: string | null;
  }>(
    `SELECT
       overdue.id AS overdue_id,
       overdue.ends_at AS overdue_ends_at,
       overdue.subject_type AS subject_type,
       overdue.subject_id AS subject_id,
       affected.id AS affected_id,
       affected.starts_at AS affected_starts_at,
       au.id AS affected_customer_user_id,
       au.email AS affected_contact_email
     FROM reservations overdue
     JOIN reservations affected
       ON affected.merchant_id = overdue.merchant_id
      AND affected.subject_type = overdue.subject_type
      AND affected.subject_id = overdue.subject_id
      AND affected.id != overdue.id
      AND affected.state IN ('HELD', 'CONFIRMED')
      AND affected.starts_at > $1
     LEFT JOIN order_lines ol ON ol.id = affected.order_line_id
     LEFT JOIN orders o ON o.id = ol.order_id
     LEFT JOIN users au ON au.id = o.customer_user_id
     WHERE overdue.state = 'IN_USE'
       AND overdue.ends_at < $1
     ORDER BY affected.starts_at ASC`,
    [asOf],
  );

  const alerts: DownstreamConflictAlert[] = result.rows.map((row) => ({
    overdueReservationId: row.overdue_id,
    overdueEndsAt: row.overdue_ends_at,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    affectedReservationId: row.affected_id,
    affectedStartsAt: row.affected_starts_at,
    affectedCustomerUserId: row.affected_customer_user_id,
    affectedContactEmail: row.affected_contact_email,
  }));

  notifyAll(alerts, notifiers);
  return { alerts };
}
