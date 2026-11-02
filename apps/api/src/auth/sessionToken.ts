import type { FastifyRequest } from "fastify";

const SESSION_COOKIE = "session";
const BEARER_PREFIX = "Bearer ";

/**
 * Resolves the opaque session token a request is presenting, from either
 * source a client might use: the `session` httpOnly cookie (`apps/web`,
 * per ADR-002) or an `Authorization: Bearer <token>` header (`apps/mobile`,
 * `docs/cards/D138.md` — a mobile app has no cookie jar to rely on, and
 * stores its access token in Keychain/Keystore instead). Both resolve to
 * the exact same kind of token — `AuthProvider.verifySession` doesn't
 * distinguish where it came from — so this is purely about locating it.
 */
export function extractSessionToken(request: FastifyRequest): string | undefined {
  const cookieToken = request.cookies[SESSION_COOKIE];
  if (cookieToken) {
    return cookieToken;
  }
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith(BEARER_PREFIX)) {
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : undefined;
  }
  return undefined;
}
