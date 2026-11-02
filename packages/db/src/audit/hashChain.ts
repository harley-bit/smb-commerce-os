import { createHash } from "node:crypto";

/**
 * `docs/design/03`: `row_hash = SHA256(prev_hash || canonical_json(row_without_hashes))`.
 * The first row in a merchant's chain has no predecessor, so it chains
 * from this fixed all-zero anchor rather than an empty string — makes a
 * missing/empty prevHash visually distinct from a genuinely corrupted one.
 */
export const AUDIT_LOG_GENESIS_HASH = "0".repeat(64);

/** The `audit_log` row content that feeds the hash — everything except `prev_hash`/`row_hash` themselves. */
export interface AuditLogRowForHash {
  id: string;
  merchantId: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: string;
}

/**
 * Deterministic JSON serialization: object keys sorted, so the same row
 * always hashes the same way regardless of the order its fields were
 * constructed or read back from the database in.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const serialized = entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`);
  return `{${serialized.join(",")}}`;
}

/**
 * `docs/design/03`/`07`'s hash chain: binds a row to both its own content
 * and its predecessor's hash, so altering any field of any row — or
 * splicing/reordering rows — changes a hash that a later row already
 * committed to. `verifyAuditChain` (`./verifyChain.ts`) is what actually
 * walks a chain and reports the break; this function is the one place the
 * hash itself is computed, so appending and verifying can never disagree
 * on the algorithm.
 */
export function computeRowHash(prevHash: string, row: AuditLogRowForHash): string {
  return createHash("sha256").update(prevHash).update(canonicalJson(row)).digest("hex");
}
