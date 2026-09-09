import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenantContext, generateUuidV7, type AuthIdentity, type AuthProvider } from "@smb-os/domain";
import {
  createConnection,
  runSqliteMigrations,
  AuditLogRepository,
  MerchantRepository,
  MerchantUserRepository,
  UserRepository,
  type Connection,
  type MerchantUserRole,
  type RoleChangeEvent,
} from "@smb-os/db";
import { buildApp } from "../src/app";
import { DbMerchantMembershipResolver } from "../src/auth/authenticate";

const CREATED_AT = "2026-09-09T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  merchantId: string;
  ownerId: string;
  ownerHeaders: Record<string, string>;
  headersFor: (userId: string, token: string) => Record<string, string>;
  app: FastifyInstance;
}

async function setupFixture(notified: Array<{ event: RoleChangeEvent; ownerId: string }> = []): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  merchants.create(ctx, {
    name: "acme",
    slug: `acme-${generateUuidV7()}`,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });
  const merchantId = ctx.merchantId;

  const dbUsers = new UserRepository(connection);
  const ownerId = dbUsers.create({ email: "owner@example.com", status: "ACTIVE", createdAt: CREATED_AT });
  const merchantUsers = new MerchantUserRepository(connection);
  merchantUsers.assignRole(ctx, "OWNER", ownerId, "OWNER", CREATED_AT);

  const identities = new Map<string, AuthIdentity>();
  identities.set("owner-token", { userId: ownerId, email: "owner@example.com", roles: ["OWNER"] });

  const fakeAuthProvider: AuthProvider = {
    register: () => Promise.reject(new Error("not implemented")),
    authenticate: () => Promise.reject(new Error("not implemented")),
    createSession: () => Promise.reject(new Error("not implemented")),
    verifySession: (token) => Promise.resolve(identities.get(token) ?? null),
    revokeSession: () => Promise.resolve(),
    initiatePasswordReset: () => Promise.resolve(),
    completePasswordReset: () => Promise.reject(new Error("not implemented")),
    enrollMfa: () => Promise.reject(new Error("not implemented")),
    confirmMfaEnrollment: () => Promise.reject(new Error("not implemented")),
  };

  const app = buildApp({
    authProvider: fakeAuthProvider,
    merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    connection,
    onRoleChanged: (event, targetOwnerId) => notified.push({ event, ownerId: targetOwnerId }),
  });

  function headersFor(userId: string, token: string): Record<string, string> {
    identities.set(token, { userId, email: `${userId}@example.com`, roles: [] });
    return { cookie: `session=${token}`, "x-merchant-id": merchantId };
  }

  return {
    connection,
    merchantId,
    ownerId,
    ownerHeaders: { cookie: "session=owner-token", "x-merchant-id": merchantId },
    headersFor,
    app,
  };
}

function addMember(fx: Fixture, role: MerchantUserRole): { userId: string; headers: Record<string, string> } {
  const ctx = createTenantContext(fx.merchantId);
  const dbUsers = new UserRepository(fx.connection);
  const merchantUsers = new MerchantUserRepository(fx.connection);
  const userId = dbUsers.create({ email: `member-${generateUuidV7()}@example.com`, status: "ACTIVE", createdAt: CREATED_AT });
  merchantUsers.assignRole(ctx, "OWNER", userId, role, CREATED_AT);
  const token = `token-${userId}`;
  return { userId, headers: fx.headersFor(userId, token) };
}

describe("team routes — Settings and team, Gate G6 (D120)", () => {
  it("GET /team lists members for the OWNER", async () => {
    const fx = await setupFixture();
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({ method: "GET", url: "/team", headers: fx.ownerHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ userId: string; role: string }>;
    expect(body.map((m) => m.userId).sort()).toEqual([fx.ownerId, staff.userId].sort());
  });

  it("GET /team is forbidden for a non-OWNER", async () => {
    const fx = await setupFixture();
    const admin = addMember(fx, "ADMIN");

    const res = await fx.app.inject({ method: "GET", url: "/team", headers: admin.headers });
    expect(res.statusCode).toBe(403);
  });

  it("OWNER can assign a role; response is 204 and the change is durably persisted", async () => {
    const fx = await setupFixture();
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: fx.ownerHeaders,
      payload: { userId: staff.userId, role: "ADMIN" },
    });
    expect(res.statusCode).toBe(204);

    const list = await fx.app.inject({ method: "GET", url: "/team", headers: fx.ownerHeaders });
    const body = list.json() as Array<{ userId: string; role: string }>;
    expect(body.find((m) => m.userId === staff.userId)?.role).toBe("ADMIN");
  });

  it("a non-OWNER cannot assign a role — 403, no write, no audit entry", async () => {
    const fx = await setupFixture();
    const admin = addMember(fx, "ADMIN");
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: admin.headers,
      payload: { userId: staff.userId, role: "OWNER" },
    });
    expect(res.statusCode).toBe(403);

    const auditLog = new AuditLogRepository(fx.connection);
    const ctx = createTenantContext(fx.merchantId);
    expect(auditLog.list(ctx)).toHaveLength(0);
  });

  it("rejects an invalid role with 400", async () => {
    const fx = await setupFixture();
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: fx.ownerHeaders,
      payload: { userId: staff.userId, role: "SUPERUSER" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing userId with 400", async () => {
    const fx = await setupFixture();

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: fx.ownerHeaders,
      payload: { role: "STAFF" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing role with 400", async () => {
    const fx = await setupFixture();
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: fx.ownerHeaders,
      payload: { userId: staff.userId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("this card's security check: a role change is audit-logged and every current OWNER is notified", async () => {
    const notified: Array<{ event: RoleChangeEvent; ownerId: string }> = [];
    const fx = await setupFixture(notified);
    const staff = addMember(fx, "STAFF");

    const res = await fx.app.inject({
      method: "POST",
      url: "/team/role-assignments",
      headers: fx.ownerHeaders,
      payload: { userId: staff.userId, role: "ADMIN" },
    });
    expect(res.statusCode).toBe(204);

    const auditLog = new AuditLogRepository(fx.connection);
    const ctx = createTenantContext(fx.merchantId);
    const entries = auditLog.list(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("merchant_user.role_changed");
    expect(entries[0]?.entityId).toBe(staff.userId);

    expect(notified).toHaveLength(1);
    expect(notified[0]?.ownerId).toBe(fx.ownerId);
    expect(notified[0]?.event.newRole).toBe("ADMIN");
  });
});
