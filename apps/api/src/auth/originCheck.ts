/**
 * CSRF defense for cookie-authenticated, state-changing requests
 * (ADR-002: "standard double-submit or SameSite=Strict plus origin
 * checks"). The session cookie is already SameSite=Strict; this adds
 * the origin-check half so a same-site-but-cross-origin form post
 * (rare, but not impossible depending on browser/embedding) is also
 * rejected.
 */
export function isAllowedOrigin(
  headerOrigin: string | undefined,
  headerReferer: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  const origin = headerOrigin ?? (headerReferer ? new URL(headerReferer).origin : undefined);
  if (!origin) {
    // No Origin/Referer at all (e.g. a same-origin fetch some browsers
    // omit it for) — don't block on absence, only on a mismatch.
    return true;
  }
  return allowedOrigins.includes(origin);
}
