import type { Pool } from "pg";
import {
  createTenantContext,
  evaluateMediaRetention,
  generateUuidV7,
  type MediaRetentionClaimStatus,
} from "@smb-os/domain";
import type { Connection } from "../connection.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { AUDIT_LOG_GENESIS_HASH, computeRowHash } from "../audit/hashChain.js";

/**
 * `docs/design/08` "Condition media — the hard case" and `docs/design/14`
 * risk T12: the retention clock is set in Phase 4, alongside the feature,
 * not deferred. The eligibility rule itself lives in
 * `@smb-os/domain`'s `evaluateMediaRetention` — this module's only job is
 * to fetch the two inputs that function needs (the rental's `CHECKIN`
 * timestamp and the order line's damage-claim status) for every
 * `condition_media` row, and to carry out a `dryRun: false` decision as an
 * actual delete plus an append-only `audit_log` record — never a silent
 * deletion.
 */
export interface MediaRetentionCandidate {
  id: string;
  merchantId: string;
  conditionReportId: string;
  orderLineId: string;
  storageKey: string;
  reason: "NO_CLAIM_90_DAYS" | "CLAIM_RESOLVED_2_YEARS";
}

export interface MediaRetentionRunResult {
  dryRun: boolean;
  candidates: MediaRetentionCandidate[];
  deletedMediaIds: string[];
}

/** Removes the object from wherever `condition_media.storage_key` actually lives. Never called in dry-run mode. */
export type MediaObjectDeleter = (candidate: MediaRetentionCandidate) => void | Promise<void>;

const SYSTEM_ACTOR_ID = "system:media-retention-job";

interface MediaRow {
  id: string;
  merchant_id: string;
  condition_report_id: string;
  order_line_id: string;
  storage_key: string;
  checkin_at: string | null;
}

interface ClaimRow {
  order_line_id: string;
  state: "DRAFT" | "FILED" | "CUSTOMER_NOTIFIED" | "RESOLVED_CAPTURED" | "RESOLVED_WAIVED" | "DISPUTED";
  resolved_at: string | null;
}

/**
 * Combines every damage claim on file for one order line into the single
 * `MediaRetentionClaimStatus` `evaluateMediaRetention` needs. A live or
 * disputed claim always wins over a resolved one on the same line — this
 * job never deletes evidence while any claim on the line is still open.
 */
function combineClaimStatus(claims: ClaimRow[]): MediaRetentionClaimStatus {
  if (claims.length === 0) {
    return { kind: "NONE" };
  }
  if (claims.some((c) => c.state === "DISPUTED")) {
    return { kind: "DISPUTED" };
  }
  if (claims.some((c) => c.state === "DRAFT" || c.state === "FILED" || c.state === "CUSTOMER_NOTIFIED")) {
    return { kind: "LIVE" };
  }
  const resolvedAt = claims
    .map((c) => c.resolved_at)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1);
  if (resolvedAt === undefined) {
    // Every claim is in a resolved state but somehow lacks resolved_at — treat as still live rather than guess a deadline.
    return { kind: "LIVE" };
  }
  return { kind: "RESOLVED", resolvedAt };
}

function findCandidates(mediaRows: MediaRow[], claimRows: ClaimRow[], now: Date): MediaRetentionCandidate[] {
  const claimsByOrderLine = new Map<string, ClaimRow[]>();
  for (const claim of claimRows) {
    const existing = claimsByOrderLine.get(claim.order_line_id);
    if (existing) {
      existing.push(claim);
    } else {
      claimsByOrderLine.set(claim.order_line_id, [claim]);
    }
  }

  const candidates: MediaRetentionCandidate[] = [];
  for (const row of mediaRows) {
    if (row.checkin_at === null) {
      continue; // rental hasn't completed yet — never eligible
    }
    const claimStatus = combineClaimStatus(claimsByOrderLine.get(row.order_line_id) ?? []);
    const decision = evaluateMediaRetention({ rentalCompletedAt: row.checkin_at, claimStatus }, now);
    if (decision.eligible) {
      candidates.push({
        id: row.id,
        merchantId: row.merchant_id,
        conditionReportId: row.condition_report_id,
        orderLineId: row.order_line_id,
        storageKey: row.storage_key,
        reason: decision.reason,
      });
    }
  }
  return candidates;
}

const SELECT_MEDIA_SQLITE = `
  SELECT cm.id, cm.merchant_id, cm.condition_report_id, cr.order_line_id, cm.storage_key,
         (SELECT MIN(created_at) FROM condition_reports
           WHERE order_line_id = cr.order_line_id AND phase = 'CHECKIN') AS checkin_at
    FROM condition_media cm
    JOIN condition_reports cr ON cr.id = cm.condition_report_id
`;

const SELECT_CLAIMS_SQLITE = `SELECT order_line_id, state, resolved_at FROM damage_claims`;

/**
 * `dryRun: true` runs the same eligibility query and returns the exact list
 * that would be deleted, touching no data. `dryRun: false` deletes each
 * eligible `condition_media` row, calls `deleteObject` for the underlying
 * object (skipped entirely in dry-run mode), and appends one `audit_log`
 * entry per deletion — so "the dry run says N, the audit log has N new rows"
 * is always checkable after a real run.
 */
export async function runMediaRetentionSqlite(
  conn: Connection,
  options: { now: Date; dryRun: boolean },
  deleteObject?: MediaObjectDeleter,
): Promise<MediaRetentionRunResult> {
  const mediaRows = conn.sqlite.prepare(SELECT_MEDIA_SQLITE).all() as MediaRow[];
  const claimRows = conn.sqlite.prepare(SELECT_CLAIMS_SQLITE).all() as ClaimRow[];
  const candidates = findCandidates(mediaRows, claimRows, options.now);

  if (options.dryRun || candidates.length === 0) {
    return { dryRun: options.dryRun, candidates, deletedMediaIds: [] };
  }

  const auditLogRepo = new AuditLogRepository(conn);
  const deleteStmt = conn.sqlite.prepare(`DELETE FROM condition_media WHERE id = ?`);
  const deletedMediaIds: string[] = [];
  const occurredAt = options.now.toISOString();

  for (const candidate of candidates) {
    const result = deleteStmt.run(candidate.id);
    if (result.changes === 0) {
      continue; // already deleted by a prior run
    }
    await deleteObject?.(candidate);

    const ctx = createTenantContext(candidate.merchantId);
    auditLogRepo.append(ctx, {
      actorType: "SYSTEM",
      actorId: SYSTEM_ACTOR_ID,
      action: "CONDITION_MEDIA_RETENTION_DELETED",
      entityType: "condition_media",
      entityId: candidate.id,
      beforeJson: JSON.stringify({ storageKey: candidate.storageKey, reason: candidate.reason }),
      occurredAt,
    });
    deletedMediaIds.push(candidate.id);
  }

  return { dryRun: false, candidates, deletedMediaIds };
}

/** PostgreSQL side of the same job — same eligibility logic, same dry-run/audit contract. */
export async function runMediaRetentionPg(
  pool: Pool,
  options: { now: Date; dryRun: boolean },
  deleteObject?: MediaObjectDeleter,
): Promise<MediaRetentionRunResult> {
  const client = await pool.connect();
  try {
    const mediaResult = await client.query<{
      id: string;
      merchant_id: string;
      condition_report_id: string;
      order_line_id: string;
      storage_key: string;
      checkin_at: string | null;
    }>(
      `SELECT cm.id, cm.merchant_id, cm.condition_report_id, cr.order_line_id, cm.storage_key,
              (SELECT MIN(created_at) FROM condition_reports
                WHERE order_line_id = cr.order_line_id AND phase = 'CHECKIN') AS checkin_at
         FROM condition_media cm
         JOIN condition_reports cr ON cr.id = cm.condition_report_id`,
    );
    const claimResult = await client.query<ClaimRow>(
      `SELECT order_line_id, state, resolved_at FROM damage_claims`,
    );

    const mediaRows: MediaRow[] = mediaResult.rows.map((r) => ({
      ...r,
      checkin_at: r.checkin_at === null ? null : new Date(r.checkin_at).toISOString(),
    }));
    const claimRows: ClaimRow[] = claimResult.rows.map((r) => ({
      ...r,
      resolved_at: r.resolved_at === null ? null : new Date(r.resolved_at).toISOString(),
    }));

    const candidates = findCandidates(mediaRows, claimRows, options.now);

    if (options.dryRun || candidates.length === 0) {
      return { dryRun: options.dryRun, candidates, deletedMediaIds: [] };
    }

    const deletedMediaIds: string[] = [];
    const occurredAt = options.now.toISOString();

    await client.query("BEGIN");
    try {
      for (const candidate of candidates) {
        const deleteResult = await client.query(`DELETE FROM condition_media WHERE id = $1`, [candidate.id]);
        if (deleteResult.rowCount === 0) {
          continue;
        }
        await deleteObject?.(candidate);

        const previous = await client.query<{ row_hash: string; seq: number }>(
          `SELECT row_hash, seq FROM audit_log WHERE merchant_id = $1 ORDER BY seq DESC LIMIT 1`,
          [candidate.merchantId],
        );
        const prevHash = previous.rows[0]?.row_hash ?? AUDIT_LOG_GENESIS_HASH;
        const seq = previous.rows[0] ? previous.rows[0].seq + 1 : 0;
        const beforeJson = JSON.stringify({ storageKey: candidate.storageKey, reason: candidate.reason });

        const id = generateUuidV7();
        const rowForHash = {
          id,
          merchantId: candidate.merchantId,
          actorType: "SYSTEM" as const,
          actorId: SYSTEM_ACTOR_ID,
          action: "CONDITION_MEDIA_RETENTION_DELETED",
          entityType: "condition_media",
          entityId: candidate.id,
          beforeJson,
          afterJson: null,
          ip: null,
          userAgent: null,
          occurredAt,
        };
        const rowHash = computeRowHash(prevHash, rowForHash);

        await client.query(
          `INSERT INTO audit_log
             (id, merchant_id, seq, actor_type, actor_id, action, entity_type, entity_id,
              before_json, after_json, ip, user_agent, occurred_at, prev_hash, row_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            id,
            candidate.merchantId,
            seq,
            "SYSTEM",
            SYSTEM_ACTOR_ID,
            "CONDITION_MEDIA_RETENTION_DELETED",
            "condition_media",
            candidate.id,
            beforeJson,
            null,
            null,
            null,
            occurredAt,
            prevHash,
            rowHash,
          ],
        );
        deletedMediaIds.push(candidate.id);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    return { dryRun: false, candidates, deletedMediaIds };
  } finally {
    client.release();
  }
}
