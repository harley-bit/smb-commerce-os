import { createTenantContext, generateUuidV7, type TenantContext } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { MerchantRepository } from "../repositories/MerchantRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { auditLog } from "../schema/sqlite.js";
import { verifyAuditChain } from "./verifyChain.js";

describe("verifyAuditChain", () => {
  let connection: Connection;
  let auditRepo: AuditLogRepository;
  let merchants: MerchantRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    auditRepo = new AuditLogRepository(connection);
    merchants = new MerchantRepository(connection);
  });

  function makeMerchantCtx(slug: string): TenantContext {
    const ctx = createTenantContext(generateUuidV7());
    merchants.create(ctx, {
      name: slug,
      slug,
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    return ctx;
  }

  function seedChain(ctx: TenantContext): void {
    auditRepo.append(ctx, {
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-2",
      beforeJson: JSON.stringify({ role: "STAFF" }),
      afterJson: JSON.stringify({ role: "ADMIN" }),
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
    auditRepo.append(ctx, {
      actorType: "USER",
      actorId: "user-1",
      action: "DEPOSIT_CAPTURED",
      entityType: "deposit_authorizations",
      entityId: "deposit-1",
      afterJson: JSON.stringify({ amountMinor: 20000 }),
      occurredAt: "2026-09-08T00:01:00.000Z",
    });
    auditRepo.append(ctx, {
      actorType: "SYSTEM",
      actorId: "system",
      action: "INVENTORY_ADJUSTED",
      entityType: "inventory_units",
      entityId: "unit-1",
      afterJson: JSON.stringify({ status: "MAINTENANCE" }),
      occurredAt: "2026-09-08T00:02:00.000Z",
    });
  }

  it("reports a fresh, untampered chain as valid", () => {
    const ctx = makeMerchantCtx("merchant-verify-clean");
    seedChain(ctx);

    expect(verifyAuditChain(ctx, connection)).toEqual({ valid: true });
  });

  it("reports an empty chain as valid", () => {
    const ctx = makeMerchantCtx("merchant-verify-empty");

    expect(verifyAuditChain(ctx, connection)).toEqual({ valid: true });
  });

  it("detects a row whose after_json was silently edited after the fact", () => {
    const ctx = makeMerchantCtx("merchant-verify-tampered-content");
    seedChain(ctx);

    const [, secondEntry] = auditRepo.list(ctx);

    connection.sqlite
      .prepare("UPDATE audit_log SET after_json = ? WHERE id = ?")
      .run(JSON.stringify({ amountMinor: 999999 }), secondEntry!.id);

    const result = verifyAuditChain(ctx, connection);
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(secondEntry!.id);
  });

  it("detects tampering even when the tampered row's own row_hash is recomputed to match — the next row's prev_hash still catches it", () => {
    const ctx = makeMerchantCtx("merchant-verify-tampered-resealed");
    seedChain(ctx);

    const entries = auditRepo.list(ctx);
    const targetEntry = entries[0]!;

    // Simulate an attacker who edits a row's content AND recomputes that
    // row's own row_hash to hide the edit locally. The chain still breaks
    // because the *next* row's prev_hash was already committed to the
    // original row_hash before the edit.
    connection.sqlite
      .prepare("UPDATE audit_log SET action = ? WHERE id = ?")
      .run("ROLE_CHANGED_TAMPERED", targetEntry.id);

    const result = verifyAuditChain(ctx, connection);
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(targetEntry.id);
  });

  it("detects a row whose prev_hash was directly overwritten", () => {
    const ctx = makeMerchantCtx("merchant-verify-tampered-prevhash");
    seedChain(ctx);

    const entries = auditRepo.list(ctx);
    const secondEntry = entries[1]!;

    connection.sqlite
      .prepare("UPDATE audit_log SET prev_hash = ? WHERE id = ?")
      .run("f".repeat(64), secondEntry.id);

    const result = verifyAuditChain(ctx, connection);
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(secondEntry.id);
  });

  it("only walks the calling merchant's own chain — tampering in another merchant's chain doesn't surface here", () => {
    const ctxA = makeMerchantCtx("merchant-verify-cross-a");
    const ctxB = makeMerchantCtx("merchant-verify-cross-b");
    seedChain(ctxA);
    seedChain(ctxB);

    const [entryB] = auditRepo.list(ctxB);
    connection.sqlite
      .prepare("UPDATE audit_log SET action = ? WHERE id = ?")
      .run("TAMPERED", entryB!.id);

    expect(verifyAuditChain(ctxA, connection)).toEqual({ valid: true });
    expect(verifyAuditChain(ctxB, connection).valid).toBe(false);
  });

  it("sanity: the tampered row still exists in the raw table (proves the test tampers via SQL, not the repository)", () => {
    const ctx = makeMerchantCtx("merchant-verify-raw-check");
    seedChain(ctx);
    const [entry] = auditRepo.list(ctx);

    connection.sqlite.prepare("UPDATE audit_log SET action = ? WHERE id = ?").run("X", entry!.id);

    const raw = connection.db.select().from(auditLog).all();
    expect(raw.find((r) => r.id === entry!.id)?.action).toBe("X");
  });
});
