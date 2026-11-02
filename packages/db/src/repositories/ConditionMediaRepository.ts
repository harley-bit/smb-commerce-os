import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { conditionMedia } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface ConditionMediaRecord {
  id: string;
  merchantId: string;
  conditionReportId: string;
  storageKey: string;
  contentType: string;
  bytes: number;
  sha256: string;
  capturedAt: string;
}

export interface CreateConditionMediaInput {
  conditionReportId: string;
  storageKey: string;
  contentType: string;
  bytes: number;
  sha256: string;
  capturedAt: string;
}

/**
 * `docs/design/03` "Rental lifecycle" / `docs/cards/D074.md` — the confirmed,
 * hash-verified record of one piece of condition media. `condition_media`'s
 * `storage_key` column carries a unique index (`condition_media_storage_key_unique`)
 * so a second `create()` for the same key is rejected by the database even if
 * the application-layer check in `ConditionMediaConfirmService` were ever
 * bypassed — the same belt-and-suspenders pattern D030 documents for its
 * append-only audit log.
 */
export class ConditionMediaRepository extends TenantScopedRepository<
  typeof conditionMedia.merchantId
> {
  constructor(private readonly conn: Connection) {
    super(conditionMedia.merchantId);
  }

  create: RepositoryMethod<[input: CreateConditionMediaInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(conditionMedia)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  findByStorageKey: RepositoryMethod<[storageKey: string], ConditionMediaRecord | undefined> = (
    ctx,
    storageKey,
  ) => {
    return this.conn.db
      .select()
      .from(conditionMedia)
      .where(and(this.scope(ctx), eq(conditionMedia.storageKey, storageKey)))
      .get() as ConditionMediaRecord | undefined;
  };

  listByConditionReport: RepositoryMethod<[conditionReportId: string], ConditionMediaRecord[]> = (
    ctx,
    conditionReportId,
  ) => {
    return this.conn.db
      .select()
      .from(conditionMedia)
      .where(and(this.scope(ctx), eq(conditionMedia.conditionReportId, conditionReportId)))
      .all() as ConditionMediaRecord[];
  };
}
