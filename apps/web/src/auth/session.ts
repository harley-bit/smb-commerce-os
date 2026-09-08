import type { SessionUser } from "./access";

/**
 * Resolves the caller's session by forwarding the incoming request's raw
 * `Cookie` header to `apps/api`'s `GET /auth/me` — never by reading or
 * decoding the session cookie's value ourselves. The cookie is httpOnly,
 * Secure, `SameSite=Strict` (ADR-002); this app never sees, stores, or
 * forwards the token anywhere except this one server-to-server call, and
 * every check is re-verified against the API on each request rather than
 * cached in memory or a client-readable store.
 */
export async function fetchSession(apiBaseUrl: string, cookieHeader: string | undefined): Promise<SessionUser | null> {
  if (!cookieHeader) {
    return null;
  }
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as SessionUser;
}
