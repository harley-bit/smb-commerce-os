import { createTenantContext, generateUuidV7, ForbiddenActionError, type TenantContext } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { MerchantRepository } from "../repositories/MerchantRepository.js";
import { MerchantUserRepository } from "../repositories/MerchantUserRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { MerchantUserService, type RoleChangeEvent } from "./MerchantUserService.js";

const OCCURRED_AT = "2026-09-09T00:00:00.000Z";

describe("MerchantUserService", () => {
  let connection: Connection;
  let merchantUsers: MerchantUserRepository;
  let auditLog: AuditLogRepository;
  let users: UserRepository;
  let merchants: MerchantRepository;
  let ctx: TenantContext;
  let ownerId: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    merchantUsers = new MerchantUserRepository(connection);
    auditLog = new AuditLogRepository(connection);
    users = new UserRepository(connection);
    merchants = new MerchantRepository(connection);

    ctx = createTenantContext(generateUuidV7());
    merchants.create(ctx, {
      name: "acme",
      slug: `acme-${generateUuidV7()}`,
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: OCCURRED_AT,
    });
    ownerId = users.create({ email: "owner@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });
    merchantUsers.assignRole(ctx, "OWNER", ownerId, "OWNER", OCCURRED_AT);
  });

  it("rejects role assignment from a non-OWNER caller before any write or audit entry", () => {
    const service = new MerchantUserService(merchantUsers, auditLog);
    const staffId = users.create({ email: "staff@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });

    expect(() =>
      service.assignRole(ctx, "ADMIN", ownerId, staffId, "STAFF", OCCURRED_AT),
    ).toThrow(ForbiddenActionError);

    expect(merchantUsers.findRole(ctx, staffId)).toBeUndefined();
    expect(auditLog.list(ctx)).toHaveLength(0);
  });

  it("audit-logs a role change with before/after role captured", () => {
    const service = new MerchantUserService(merchantUsers, auditLog);
    const staffId = users.create({ email: "staff2@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });

    service.assignRole(ctx, "OWNER", ownerId, staffId, "STAFF", OCCURRED_AT);

    const entries = auditLog.list(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("merchant_user.role_changed");
    expect(entries[0]?.entityType).toBe("merchant_user");
    expect(entries[0]?.entityId).toBe(staffId);
    expect(entries[0]?.actorId).toBe(ownerId);
    expect(JSON.parse(entries[0]!.beforeJson ?? "null")).toEqual({ role: null });
    expect(JSON.parse(entries[0]!.afterJson ?? "null")).toEqual({ role: "STAFF" });
  });

  it("records the previous role in the audit entry when changing an existing member's role", () => {
    const service = new MerchantUserService(merchantUsers, auditLog);
    const staffId = users.create({ email: "staff3@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });
    service.assignRole(ctx, "OWNER", ownerId, staffId, "STAFF", OCCURRED_AT);

    service.assignRole(ctx, "OWNER", ownerId, staffId, "ADMIN", OCCURRED_AT);

    const entries = auditLog.list(ctx);
    expect(entries).toHaveLength(2);
    expect(JSON.parse(entries[1]!.beforeJson ?? "null")).toEqual({ role: "STAFF" });
    expect(JSON.parse(entries[1]!.afterJson ?? "null")).toEqual({ role: "ADMIN" });
  });

  it("notifies every current OWNER of the merchant, and only owners, on a role change", () => {
    const notified: Array<{ event: RoleChangeEvent; ownerId: string }> = [];
    const service = new MerchantUserService(merchantUsers, auditLog, (event, targetOwnerId) => {
      notified.push({ event, ownerId: targetOwnerId });
    });

    const secondOwnerId = users.create({ email: "owner2@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });
    merchantUsers.assignRole(ctx, "OWNER", secondOwnerId, "OWNER", OCCURRED_AT);
    const staffId = users.create({ email: "staff4@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });

    service.assignRole(ctx, "OWNER", ownerId, staffId, "STAFF", OCCURRED_AT);

    const notifiedOwnerIds = notified.map((n) => n.ownerId).sort();
    expect(notifiedOwnerIds).toEqual([ownerId, secondOwnerId].sort());
    expect(notified.every((n) => n.event.targetUserId === staffId)).toBe(true);
    expect(notified.every((n) => n.event.newRole === "STAFF")).toBe(true);
  });

  it("does not notify anyone, and writes no audit entry, when the assignment is rejected", () => {
    const notified: unknown[] = [];
    const service = new MerchantUserService(merchantUsers, auditLog, (event) => notified.push(event));
    const staffId = users.create({ email: "staff5@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });

    expect(() =>
      service.assignRole(ctx, "STAFF", ownerId, staffId, "ADMIN", OCCURRED_AT),
    ).toThrow(ForbiddenActionError);

    expect(notified).toHaveLength(0);
    expect(auditLog.list(ctx)).toHaveLength(0);
  });

  it("lists team members, restricted to OWNER", () => {
    const service = new MerchantUserService(merchantUsers, auditLog);
    const staffId = users.create({ email: "staff6@acme.test", status: "ACTIVE", createdAt: OCCURRED_AT });
    service.assignRole(ctx, "OWNER", ownerId, staffId, "STAFF", OCCURRED_AT);

    const list = service.list(ctx, "OWNER");
    expect(list.map((m) => m.userId).sort()).toEqual([ownerId, staffId].sort());

    expect(() => service.list(ctx, "ADMIN")).toThrow(ForbiddenActionError);
  });
});
