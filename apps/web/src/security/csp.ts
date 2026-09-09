/**
 * Builds a strict Content-Security-Policy header value for a single request.
 * Every directive is an explicit allowlist (no `unsafe-inline`, no
 * `unsafe-eval`): scripts are only trusted via the per-request nonce plus
 * `strict-dynamic` (the framework's own script-injected chunks inherit
 * trust from the nonce'd root script, per the CSP3 strict-dynamic model),
 * and styles/fonts/images/connections are restricted to same-origin. The
 * nonce must be freshly generated per request by the caller (see
 * `middleware.ts`) — reusing one across requests would let an attacker who
 * captures it once bypass the policy for every later request.
 */
export function buildCspHeader(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
