import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "./auth/access";
import { findRouteRule } from "./auth/routeRules";
import { fetchSession } from "./auth/session";
import { buildCspHeader } from "./security/csp";

const API_BASE_URL = process.env.API_URL ?? "http://localhost:3001";

// Every response — not just the auth-gated /dashboard tree — carries a
// strict, nonce-based CSP (see security/csp.ts). The nonce is generated
// fresh per request and forwarded as both a request header (so
// app/layout.tsx can read it via `headers()` and apply it to Next's own
// framework scripts) and the response's CSP header itself.
function applyCsp(request: NextRequest, response: NextResponse): NextResponse {
  const nonce = crypto.randomUUID();
  response.headers.set("Content-Security-Policy", buildCspHeader(nonce));
  response.headers.set("x-nonce", nonce);
  request.headers.set("x-nonce", nonce);
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const rule = findRouteRule(request.nextUrl.pathname);
  if (!rule) {
    return applyCsp(request, NextResponse.next({ request: { headers: request.headers } }));
  }

  const session = await fetchSession(API_BASE_URL, request.headers.get("cookie") ?? undefined);
  const access = evaluateAccess(session, rule.roles);

  if (access.kind === "redirect") {
    return applyCsp(request, NextResponse.redirect(new URL(access.to, request.url)));
  }
  return applyCsp(request, NextResponse.next({ request: { headers: request.headers } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
