import { createTenantContext, generateUuidV7, type TenantContext } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { MerchantRepository } from "./MerchantRepository.js";
import { MerchantUserRepository } from "./MerchantUserRepository.js";
import { UserRepository } from "./UserRepository.js";

describe("MerchantUserRepository", () => {
  let connection: Connection;
  let repo: MerchantUserRepository;
  let users: UserRepository;
  let merchants: MerchantRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new MerchantUserRepository(connection);
    users = new UserRepository(connection);
    merchants = new MerchantRepository(connection);
  });

  function makeUser(email: string): string {
    return users.create({ email, status: "ACTIVE", createdAt: "2026-09-08T00:00:00.000Z" });
  }

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

  it("an OWNER can assign a role to another user", () => {
    const ctx = makeMerchantCtx("merchant-owner-assign");
    const staffId = makeUser("staff@acme.test");

    repo.assignRole(ctx, "OWNER", staffId, "STAFF", "2026-09-08T00:00:00.000Z");

    expect(repo.findRole(ctx, staffId)).toBe("STAFF");
  });

  it("rejects role assignment when the acting user is not OWNER", () => {
    const ctx = makeMerchantCtx("merchant-non-owner");
    const staffId = makeUser("staff2@acme.test");

    expect(() =>
      repo.assignRole(ctx, "ADMIN", staffId, "STAFF", "2026-09-08T00:00:00.000Z"),
    ).toThrow(/OWNER/);
    expect(repo.findRole(ctx, staffId)).toBeUndefined();
  });

  it("rejects role assignment from STAFF or READ_ONLY actors too", () => {
    const ctx = makeMerchantCtx("merchant-staff-readonly");
    const staffId = makeUser("staff3@acme.test");

    expect(() =>
      repo.assignRole(ctx, "STAFF", staffId, "ADMIN", "2026-09-08T00:00:00.000Z"),
    ).toThrow(/OWNER/);
    expect(() =>
      repo.assignRole(ctx, "READ_ONLY", staffId, "ADMIN", "2026-09-08T00:00:00.000Z"),
    ).toThrow(/OWNER/);
  });

  it("an OWNER can change an existing user's role (upsert)", () => {
    const ctx = makeMerchantCtx("merchant-upsert");
    const staffId = makeUser("staff4@acme.test");

    repo.assignRole(ctx, "OWNER", staffId, "STAFF", "2026-09-08T00:00:00.000Z");
    repo.assignRole(ctx, "OWNER", staffId, "ADMIN", "2026-09-09T00:00:00.000Z");

    expect(repo.findRole(ctx, staffId)).toBe("ADMIN");
  });

  it("lists only the calling merchant's user-role rows", () => {
    const ctxA = makeMerchantCtx("merchant-list-a");
    const ctxB = makeMerchantCtx("merchant-list-b");
    const userA = makeUser("a@acme.test");
    const userB = makeUser("b@acme.test");

    repo.assignRole(ctxA, "OWNER", userA, "OWNER", "2026-09-08T00:00:00.000Z");
    repo.assignRole(ctxB, "OWNER", userB, "OWNER", "2026-09-08T00:00:00.000Z");

    const listA = repo.list(ctxA);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.userId).toBe(userA);
  });

  it("findRole never sees another merchant's role assignment for the same user", () => {
    const ctxA = makeMerchantCtx("merchant-shared-a");
    const ctxB = makeMerchantCtx("merchant-shared-b");
    const sharedUser = makeUser("shared@acme.test");

    repo.assignRole(ctxA, "OWNER", sharedUser, "OWNER", "2026-09-08T00:00:00.000Z");

    expect(repo.findRole(ctxA, sharedUser)).toBe("OWNER");
    expect(repo.findRole(ctxB, sharedUser)).toBeUndefined();
  });

  it("an OWNER in merchant A cannot assign roles inside merchant B's scope", () => {
    const ctxA = makeMerchantCtx("merchant-cross-a");
    const ctxB = makeMerchantCtx("merchant-cross-b");
    const targetInB = makeUser("target-b@acme.test");

    repo.assignRole(ctxA, "OWNER", targetInB, "OWNER", "2026-09-08T00:00:00.000Z");

    expect(repo.findRole(ctxA, targetInB)).toBe("OWNER");
    expect(repo.findRole(ctxB, targetInB)).toBeUndefined();
  });
});
