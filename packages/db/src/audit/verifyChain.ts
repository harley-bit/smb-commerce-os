import type { TenantContext } from "@smb-os/domain";
import type { Connection } from "../connection.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { AUDIT_LOG_GENESIS_HASH, computeRowHash } from "./hashChain.js";

export interface AuditChainVerificationResult {
  readonly valid: boolean;
  readonly brokenAtId?: string;
  readonly reason?: string;
}

/**
 * The verification job named in this card's deliverable. Walks a
 * merchant's `audit_log` in append order (`AuditLogRepository.list`,
 * ordered by the time-sortable UUIDv7 `id`) and recomputes each row's hash
 * from its stored content. This is what makes tampering *detectable
 * rather than merely difficult* (the card's security check, and
 * `docs/design/07`'s stated rationale for choosing a hash chain over
 * write-only permissions): editing a row's content changes what
 * `computeRowHash` produces for it, so it no longer matches that row's
 * own stored `row_hash` — and even if an attacker recomputes and rewrites
 * that row's `row_hash` to hide the edit, the *next* row's `prev_hash`
 * still commits to the original value, so the break surfaces there
 * instead. Hiding an edit requires rewriting every row from that point
 * forward, which is the property that makes this "detectable" rather than
 * "hard to fake."
 */
export function verifyAuditChain(ctx: TenantContext, conn: Connection): AuditChainVerificationResult {
  const repo = new AuditLogRepository(conn);
  const rows = repo.list(ctx);

  let expectedPrevHash = AUDIT_LOG_GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAtId: row.id,
        reason: "prev_hash does not match the preceding row's row_hash",
      };
    }

    const recomputed = computeRowHash(row.prevHash, {
      id: row.id,
      merchantId: row.merchantId,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeJson: row.beforeJson,
      afterJson: row.afterJson,
      ip: row.ip,
      userAgent: row.userAgent,
      occurredAt: row.occurredAt,
    });

    if (recomputed !== row.rowHash) {
      return {
        valid: false,
        brokenAtId: row.id,
        reason: "row_hash does not match a fresh hash of the row's stored content",
      };
    }

    expectedPrevHash = row.rowHash;
  }

  return { valid: true };
}
