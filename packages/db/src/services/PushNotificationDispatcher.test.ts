import { buildOrderConfirmationPush, createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { PushDeviceTokenRepository } from "../repositories/PushDeviceTokenRepository.js";
import { PushNotificationDispatcher } from "./PushNotificationDispatcher.js";

describe("PushNotificationDispatcher (D148)", () => {
  let connection: Connection;
  let tokens: PushDeviceTokenRepository;
  let merchantA: string;
  let userA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    tokens = new PushDeviceTokenRepository(connection);

    merchantA = generateUuidV7();
    userA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    await connection.db.insert(sqliteSchema.users).values({
      id: userA,
      email: "a@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
  });

  it("delivers to every registered device on both iOS and Android", () => {
    const ctx = createTenantContext(merchantA);
    tokens.register(ctx, { customerUserId: userA, platform: "ios", token: "ios-token", createdAt: "2026-09-09T00:00:00.000Z" });
    tokens.register(ctx, { customerUserId: userA, platform: "android", token: "android-token", createdAt: "2026-09-09T00:00:00.000Z" });

    const sent: Array<{ platform: string; token: string }> = [];
    const dispatcher = new PushNotificationDispatcher(tokens, (input) => {
      sent.push({ platform: input.platform, token: input.token });
    });

    const push = buildOrderConfirmationPush({ orderId: "order-1", totalMinor: 1000, currency: "USD" });
    dispatcher.dispatch(ctx, userA, push);

    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.platform).sort()).toEqual(["android", "ios"]);
    expect(sent.every((s) => s.token.length > 0)).toBe(true);
  });

  it("does nothing when the customer has no registered device", () => {
    const ctx = createTenantContext(merchantA);
    let calls = 0;
    const dispatcher = new PushNotificationDispatcher(tokens, () => {
      calls += 1;
    });

    const push = buildOrderConfirmationPush({ orderId: "order-1", totalMinor: 1000, currency: "USD" });
    dispatcher.dispatch(ctx, userA, push);

    expect(calls).toBe(0);
  });
});
