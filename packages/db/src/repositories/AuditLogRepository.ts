import { generateUuidV7 } from "@smb-os/domain";
import { desc } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { auditLog } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";
import { AUDIT_LOG_GENESIS_HASH, computeRowHash, type AuditLogRowForHash } from "../audit/hashChain.js";

export type AuditActorType = "USER" | "SYSTEM" | "PLATFORM";

export interface AuditLogEntry {
  id: string;
  merchantId: string;
  seq: number;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: string;
  prevHash: string;
  rowHash: string;
}

export interface AppendAuditLogInput {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: string;
  afterJson?: string;
  ip?: string;
  userAgent?: string;
  occurredAt: string;
}

/**
 * `audit_log` scopes every query on `merchant_id`, per `docs/design/07`
 * Control #1 — and, per `docs/design/03`, every merchant's chain is
 * independent (each starts from `AUDIT_LOG_GENESIS_HASH`), so isolation
 * here isn't just "can't read another merchant's rows," it's "can't even
 * observe or influence another merchant's hash chain."
 *
 * Deliberately exposes only `append`/`list` — no `update`/`delete` method
 * exists on this class, matching the schema's append-only design. `append`
 * looks up the most recently written row for the calling merchant (by
 * `seq`, an explicit per-merchant monotonic counter this repository
 * assigns itself — UUIDv7's `id` alone is only millisecond-resolution and
 * isn't reliable ordering evidence for rows appended faster than that) to
 * chain from; it does not hold any lock across that read and the
 * following insert, so a burst of concurrent audit writes for the same
 * merchant could compute against a stale prevHash/seq — tracked as a
 * known gap, not a G3-class concurrency guarantee like reservations.
 */
export class AuditLogRepository extends TenantScopedRepository<typeof auditLog.merchantId> {
  constructor(private readonly conn: Connection) {
    super(auditLog.merchantId);
  }

  append: RepositoryMethod<[input: AppendAuditLogInput], string> = (ctx, input) => {
    const previous = this.conn.db
      .select({ rowHash: auditLog.rowHash, seq: auditLog.seq })
      .from(auditLog)
      .where(this.scope(ctx))
      .orderBy(desc(auditLog.seq))
      .limit(1)
      .get() as { rowHash: string; seq: number } | undefined;

    const prevHash = previous?.rowHash ?? AUDIT_LOG_GENESIS_HASH;
    const seq = previous ? previous.seq + 1 : 0;
    const id = generateUuidV7();

    // Only the fields `docs/design/03` names as part of `row_without_hashes`
    // feed the hash — `seq` is this repository's own ordering bookkeeping,
    // not a hashed/design column, and must stay excluded here so it can
    // never diverge from what `verifyAuditChain`'s reconstruction hashes.
    const rowForHash: AuditLogRowForHash = {
      id,
      merchantId: ctx.merchantId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.beforeJson ?? null,
      afterJson: input.afterJson ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      occurredAt: input.occurredAt,
    };

    const rowHash = computeRowHash(prevHash, rowForHash);

    this.conn.db
      .insert(auditLog)
      .values({ ...rowForHash, actorType: input.actorType, seq, prevHash, rowHash })
      .run();

    return id;
  };

  list: RepositoryMethod<[], AuditLogEntry[]> = (ctx) => {
    return this.conn.db
      .select()
      .from(auditLog)
      .where(this.scope(ctx))
      .orderBy(auditLog.seq)
      .all() as AuditLogEntry[];
  };
}
