import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { refreshSession, signIn, signOut, getAccessToken, type AuthClientDeps } from "./authClient.js";
import type { PkceAdapter } from "./pkce.js";
import type { SecureTokenStorage, TokenPair } from "./secureTokenStore.js";

function fakePkceAdapter(): PkceAdapter {
  return {
    randomBytes: (byteCount) => new Uint8Array(randomBytes(byteCount)),
    sha256Base64Url: async (input) => createHash("sha256").update(input).digest("base64url"),
  };
}

function inMemoryStorage(): SecureTokenStorage & { current: TokenPair | null } {
  const store: { current: TokenPair | null } = { current: null };
  return {
    get current() {
      return store.current;
    },
    async save(pair) {
      store.current = pair;
    },
    async load() {
      return store.current;
    },
    async clear() {
      store.current = null;
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("authClient.signIn", () => {
  it("runs the full PKCE handshake and persists the resulting tokens to secure storage", async () => {
    const storage = inMemoryStorage();
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/auth/mobile/authorize")) {
        return jsonResponse(200, { code: "the-code", expiresAt: new Date(Date.now() + 60_000).toISOString() });
      }
      if (url.endsWith("/auth/mobile/token")) {
        return jsonResponse(200, {
          accessToken: "access-1",
          accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          refreshToken: "refresh-1",
          refreshTokenExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const deps: AuthClientDeps = { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, storage, pkce: fakePkceAdapter() };
    const result = await signIn(deps, "owner@example.com", "correct-password", "123456");

    expect(result).toEqual({ ok: true });
    expect(storage.current).toEqual({ accessToken: "access-1", refreshToken: "refresh-1" });

    // The challenge sent to /authorize must be SHA256(verifier) of the
    // verifier later sent to /token — proving the client actually links
    // the two legs of the PKCE flow, not just calling both endpoints.
    const authorizeBody = calls[0].body as { codeChallenge: string; codeChallengeMethod: string; mfaCode: string };
    const tokenBody = calls[1].body as { codeVerifier: string; code: string };
    expect(authorizeBody.codeChallengeMethod).toBe("S256");
    expect(authorizeBody.codeChallenge).toBe(createHash("sha256").update(tokenBody.codeVerifier).digest("base64url"));
    expect(authorizeBody.mfaCode).toBe("123456");
    expect(tokenBody.code).toBe("the-code");
  });

  it("surfaces mfaCodeRequired without touching storage", async () => {
    const storage = inMemoryStorage();
    const fetchFn = vi.fn(async () =>
      jsonResponse(401, { detail: "A multi-factor authentication code is required.", mfaCodeRequired: true }),
    );
    const deps: AuthClientDeps = {
      baseUrl: "https://api.example.com",
      fetchFn: fetchFn as unknown as typeof fetch,
      storage,
      pkce: fakePkceAdapter(),
    };

    const result = await signIn(deps, "owner@example.com", "correct-password");

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ mfaCodeRequired: true });
    expect(storage.current).toBeNull();
  });

  it("surfaces an invalid-credentials failure without touching storage", async () => {
    const storage = inMemoryStorage();
    const fetchFn = vi.fn(async () => jsonResponse(401, { detail: "Invalid email or password." }));
    const deps: AuthClientDeps = {
      baseUrl: "https://api.example.com",
      fetchFn: fetchFn as unknown as typeof fetch,
      storage,
      pkce: fakePkceAdapter(),
    };

    const result = await signIn(deps, "owner@example.com", "wrong-password");

    expect(result).toEqual({ ok: false, error: "Invalid email or password.", mfaCodeRequired: undefined, mfaEnrollmentRequired: undefined });
    expect(storage.current).toBeNull();
  });
});

describe("authClient.refreshSession", () => {
  it("redeems the stored refresh token for a new pair and persists it", async () => {
    const storage = inMemoryStorage();
    await storage.save({ accessToken: "old-access", refreshToken: "old-refresh" });
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/auth/mobile/refresh");
      expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: "old-refresh" });
      return jsonResponse(200, {
        accessToken: "new-access",
        accessTokenExpiresAt: new Date().toISOString(),
        refreshToken: "new-refresh",
        refreshTokenExpiresAt: new Date().toISOString(),
      });
    });

    const ok = await refreshSession({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, storage });

    expect(ok).toBe(true);
    expect(storage.current).toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("clears storage and returns false when the server rejects the refresh token", async () => {
    const storage = inMemoryStorage();
    await storage.save({ accessToken: "old-access", refreshToken: "old-refresh" });
    const fetchFn = vi.fn(async () => jsonResponse(401, { detail: "Invalid, expired, or revoked refresh token." }));

    const ok = await refreshSession({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, storage });

    expect(ok).toBe(false);
    expect(storage.current).toBeNull();
  });

  it("returns false immediately with no network call when nothing is stored", async () => {
    const storage = inMemoryStorage();
    const fetchFn = vi.fn();

    const ok = await refreshSession({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, storage });

    expect(ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("authClient.signOut / getAccessToken", () => {
  it("signOut calls the logout endpoint with the stored refresh token, then clears storage even if the call fails", async () => {
    const storage = inMemoryStorage();
    await storage.save({ accessToken: "a", refreshToken: "r" });
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });

    await signOut({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, storage });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/auth/mobile/logout",
      expect.objectContaining({ body: JSON.stringify({ refreshToken: "r" }) }),
    );
    expect(storage.current).toBeNull();
  });

  it("getAccessToken reads through to storage", async () => {
    const storage = inMemoryStorage();
    expect(await getAccessToken({ storage })).toBeNull();
    await storage.save({ accessToken: "a1", refreshToken: "r1" });
    expect(await getAccessToken({ storage })).toBe("a1");
  });
});
