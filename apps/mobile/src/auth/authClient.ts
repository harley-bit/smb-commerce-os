import { createPkcePair, type PkceAdapter } from "./pkce";
import type { SecureTokenStorage } from "./secureTokenStore";

export interface AuthClientDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  storage: SecureTokenStorage;
  pkce: PkceAdapter;
}

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; mfaCodeRequired?: boolean; mfaEnrollmentRequired?: boolean };

interface MobileTokenPairResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    return body.detail ?? body.error ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

/**
 * `docs/cards/D138.md` — the mobile client side of the PKCE authorization
 * code + refresh flow `apps/api/src/routes/mobileAuth.ts` implements.
 * Every dependency (network, secure storage, PKCE crypto) is injected so
 * this orchestration logic is fully unit-testable without a real device
 * or a real HTTP server — the same dependency-injection convention this
 * codebase already uses for provider seams (`AuthProvider`, notifiers).
 */
export async function signIn(deps: AuthClientDeps, email: string, password: string, mfaCode?: string): Promise<SignInResult> {
  const { verifier, challenge } = await createPkcePair(deps.pkce);

  const authorizeRes = await deps.fetchFn(`${deps.baseUrl}/auth/mobile/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, mfaCode, codeChallenge: challenge, codeChallengeMethod: "S256" }),
  });
  if (!authorizeRes.ok) {
    const body = (await authorizeRes.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
      mfaCodeRequired?: boolean;
      mfaEnrollmentRequired?: boolean;
    };
    return {
      ok: false,
      error: body.detail ?? body.error ?? `Sign-in failed with status ${authorizeRes.status}.`,
      mfaCodeRequired: body.mfaCodeRequired,
      mfaEnrollmentRequired: body.mfaEnrollmentRequired,
    };
  }
  const { code } = (await authorizeRes.json()) as { code: string };

  const tokenRes = await deps.fetchFn(`${deps.baseUrl}/auth/mobile/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier }),
  });
  if (!tokenRes.ok) {
    return { ok: false, error: await readErrorMessage(tokenRes) };
  }
  const pair = (await tokenRes.json()) as MobileTokenPairResponse;
  await deps.storage.save({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  return { ok: true };
}

/** Redeems the stored refresh token for a fresh pair, persisting it. Returns false (and clears storage) if the refresh token is no longer valid. */
export async function refreshSession(deps: Pick<AuthClientDeps, "baseUrl" | "fetchFn" | "storage">): Promise<boolean> {
  const stored = await deps.storage.load();
  if (!stored) {
    return false;
  }
  const res = await deps.fetchFn(`${deps.baseUrl}/auth/mobile/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });
  if (!res.ok) {
    await deps.storage.clear();
    return false;
  }
  const pair = (await res.json()) as MobileTokenPairResponse;
  await deps.storage.save({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  return true;
}

export async function signOut(deps: Pick<AuthClientDeps, "baseUrl" | "fetchFn" | "storage">): Promise<void> {
  const stored = await deps.storage.load();
  if (stored) {
    await deps.fetchFn(`${deps.baseUrl}/auth/mobile/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    }).catch(() => undefined);
  }
  await deps.storage.clear();
}

export async function getAccessToken(deps: Pick<AuthClientDeps, "storage">): Promise<string | null> {
  const stored = await deps.storage.load();
  return stored?.accessToken ?? null;
}
