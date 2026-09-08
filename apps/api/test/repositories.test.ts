import { describe, expect, it } from "vitest";
import {
  InMemoryResetTokenRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "../src/auth/repositories";

describe("in-memory auth repositories (temporary until D013–D015 Drizzle wiring)", () => {
  it("UserRepository: findByEmail/findById return null for unknown records; update is a no-op for an unknown user", async () => {
    const users = new InMemoryUserRepository();
    expect(await users.findByEmail("nobody@example.com")).toBeNull();
    expect(await users.findById("no-such-id")).toBeNull();
    await expect(users.updatePasswordHash("no-such-id", "hash")).resolves.toBeUndefined();
  });

  it("SessionRepository: findByToken returns null for unknown token; revoke is a no-op for an unknown token", async () => {
    const sessions = new InMemorySessionRepository();
    expect(await sessions.findByToken("no-such-token")).toBeNull();
    await expect(sessions.revoke("no-such-token", new Date().toISOString())).resolves.toBeUndefined();
  });

  it("ResetTokenRepository: findByTokenHash returns null for unknown hash; markUsed is a no-op for an unknown hash", async () => {
    const resetTokens = new InMemoryResetTokenRepository();
    expect(await resetTokens.findByTokenHash("no-such-hash")).toBeNull();
    await expect(resetTokens.markUsed("no-such-hash", new Date().toISOString())).resolves.toBeUndefined();
  });
});
