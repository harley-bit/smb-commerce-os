import { createTenantContext, generateUuidV7, type TenantContext } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { AUDIT_LOG_GENESIS_HASH } from "../audit/hashChain.js";
import { AuditLogRepository } from "./AuditLogRepository.js";
import { MerchantRepository } from "./MerchantRepository.js";

describe("AuditLogRepository", () => {
  let connection: Connection;
  let repo: AuditLogRepository;
  let merchants: MerchantRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new AuditLogRepository(connection);
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

  it("chains the first entry from the genesis hash", () => {
    const ctx = makeMerchantCtx("merchant-first-entry");

    repo.append(ctx, {
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-2",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });

    const [entry] = repo.list(ctx);
    expect(entry?.prevHash).toBe(AUDIT_LOG_GENESIS_HASH);
    expect(entry?.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains a second entry's prevHash to the first entry's rowHash", () => {
    const ctx = makeMerchantCtx("merchant-chain");

    repo.append(ctx, {
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-2",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
    repo.append(ctx, {
      actorType: "USER",
      actorId: "user-1",
      action: "INVENTORY_ADJUSTED",
      entityType: "inventory_units",
      entityId: "unit-1",
      occurredAt: "2026-09-08T00:01:00.000Z",
    });

    const entries = repo.list(ctx);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.prevHash).toBe(entries[0]?.rowHash);
  });

  it("each merchant's chain starts from its own genesis hash — isolated per tenant", () => {
    const ctxA = makeMerchantCtx("merchant-chain-a");
    const ctxB = makeMerchantCtx("merchant-chain-b");

    repo.append(ctxA, {
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-2",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
    repo.append(ctxB, {
      actorType: "USER",
      actorId: "user-9",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-8",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });

    const [entryA] = repo.list(ctxA);
    const [entryB] = repo.list(ctxB);
    expect(entryA?.prevHash).toBe(AUDIT_LOG_GENESIS_HASH);
    expect(entryB?.prevHash).toBe(AUDIT_LOG_GENESIS_HASH);
  });

  it("list only returns the calling merchant's entries — cross-tenant isolation", () => {
    const ctxA = makeMerchantCtx("merchant-list-a");
    const ctxB = makeMerchantCtx("merchant-list-b");

    repo.append(ctxA, {
      actorType: "USER",
      actorId: "user-1",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-2",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });
    repo.append(ctxB, {
      actorType: "USER",
      actorId: "user-9",
      action: "ROLE_CHANGED",
      entityType: "merchant_users",
      entityId: "user-8",
      occurredAt: "2026-09-08T00:00:00.000Z",
    });

    const listA = repo.list(ctxA);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.entityId).toBe("user-2");

    const listB = repo.list(ctxB);
    expect(listB).toHaveLength(1);
    expect(listB[0]?.entityId).toBe("user-8");
  });
});
