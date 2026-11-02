import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { PushDeviceTokenRepository } from "./PushDeviceTokenRepository.js";

describe("PushDeviceTokenRepository", () => {
  let connection: Connection;
  let repo: PushDeviceTokenRepository;
  let merchantA: string;
  let merchantB: string;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new PushDeviceTokenRepository(connection);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    userA = generateUuidV7();
    userB = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values([
      { id: userA, email: "a@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
      { id: userB, email: "b@example.com", status: "ACTIVE", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);
  });

  it("register stores both iOS and Android tokens for the same customer", () => {
    const ctxA = createTenantContext(merchantA);
    repo.register(ctxA, { customerUserId: userA, platform: "ios", token: "ios-token-1", createdAt: "2026-09-09T00:00:00.000Z" });
    repo.register(ctxA, { customerUserId: userA, platform: "android", token: "android-token-1", createdAt: "2026-09-09T00:00:00.000Z" });

    const tokens = repo.listForCustomer(ctxA, userA);
    expect(tokens.map((t) => t.platform).sort()).toEqual(["android", "ios"]);
  });

  it("re-registering the same token updates it in place rather than duplicating", () => {
    const ctxA = createTenantContext(merchantA);
    repo.register(ctxA, { customerUserId: userA, platform: "ios", token: "ios-token-1", createdAt: "2026-09-09T00:00:00.000Z" });
    repo.register(ctxA, { customerUserId: userA, platform: "ios", token: "ios-token-1", createdAt: "2026-09-09T01:00:00.000Z" });

    const tokens = repo.listForCustomer(ctxA, userA);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.createdAt).toBe("2026-09-09T01:00:00.000Z");
  });

  it("listForCustomer is isolated per tenant", () => {
    const ctxA = createTenantContext(merchantA);
    const ctxB = createTenantContext(merchantB);
    repo.register(ctxA, { customerUserId: userA, platform: "ios", token: "ios-token-a", createdAt: "2026-09-09T00:00:00.000Z" });
    repo.register(ctxB, { customerUserId: userB, platform: "ios", token: "ios-token-b", createdAt: "2026-09-09T00:00:00.000Z" });

    expect(repo.listForCustomer(ctxA, userA)).toHaveLength(1);
    expect(repo.listForCustomer(ctxB, userA)).toHaveLength(0);
    expect(repo.listForCustomer(ctxA, userB)).toHaveLength(0);
  });
});
