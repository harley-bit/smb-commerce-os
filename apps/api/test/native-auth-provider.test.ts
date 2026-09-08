import { describe, expect, it } from "vitest";
import { AccountLockedError, InvalidCredentialsError } from "@smb-os/domain";
import { NativeAuthProvider } from "../src/auth/NativeAuthProvider";
import {
  InMemoryResetTokenRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "../src/auth/repositories";

function makeProvider() {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const resetTokens = new InMemoryResetTokenRepository();
  let issuedResetToken = "";
  const provider = new NativeAuthProvider(users, sessions, resetTokens, (_email, rawToken) => {
    issuedResetToken = rawToken;
  });
  return { provider, users, sessions, resetTokens, getIssuedResetToken: () => issuedResetToken };
}

describe("NativeAuthProvider security properties", () => {
  it("stores passwords as Argon2id hashes, never plaintext, and password never leaks into a thrown error", async () => {
    const { provider, users } = makeProvider();
    await provider.register("user@example.com", "super-secret-password");

    const record = await users.findByEmail("user@example.com");
    expect(record).not.toBeNull();
    expect(record?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(record?.passwordHash).not.toContain("super-secret-password");

    try {
      await provider.authenticate("user@example.com", "wrong-password");
      expect.unreachable("expected authenticate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect(String((error as Error).message)).not.toContain("wrong-password");
      expect(String((error as Error).stack)).not.toContain("wrong-password");
    }
  });

  it("locks an account out after repeated failed logins (progressive backoff)", async () => {
    const { provider } = makeProvider();
    await provider.register("user@example.com", "correct-password-123");

    let sawLockout = false;
    for (let i = 0; i < 10; i += 1) {
      try {
        await provider.authenticate("user@example.com", "wrong-password");
      } catch (error) {
        if (error instanceof AccountLockedError) {
          sawLockout = true;
          break;
        }
        expect(error).toBeInstanceOf(InvalidCredentialsError);
      }
    }
    expect(sawLockout).toBe(true);
  });

  it("issues opaque, revocable session tokens with an expiry, not a JWT", async () => {
    const { provider } = makeProvider();
    const { userId } = await provider.register("user@example.com", "correct-password-123");
    const session = await provider.createSession(userId, "127.0.0.1", "test-agent");

    // Opaque: not three base64url segments separated by dots (a JWT shape).
    expect(session.token.split(".").length).toBe(1);
    expect(session.expiresAt > session.createdAt).toBe(true);

    const contextBefore = await provider.verifySession(session.token);
    expect(contextBefore?.userId).toBe(userId);

    await provider.revokeSession(session.token);
    const contextAfter = await provider.verifySession(session.token);
    expect(contextAfter).toBeNull();
  });

  it("hashes the password reset token before storing it (never the raw token)", async () => {
    const { provider, resetTokens, getIssuedResetToken } = makeProvider();
    await provider.register("user@example.com", "correct-password-123");

    await provider.initiatePasswordReset("user@example.com");
    const issuedToken = getIssuedResetToken();

    expect(issuedToken).not.toBe("");
    const stored = await resetTokens.findByTokenHash(issuedToken);
    expect(stored).toBeNull(); // raw token is never a valid lookup key
  });

  it("does not reveal whether an email is registered when initiating a reset", async () => {
    const { provider, getIssuedResetToken } = makeProvider();
    await provider.initiatePasswordReset("ghost@example.com");
    expect(getIssuedResetToken()).toBe("");
  });
});
