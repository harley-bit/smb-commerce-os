import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "./auth/access";
import { findRouteRule } from "./auth/routeRules";
import { fetchSession } from "./auth/session";

const API_BASE_URL = process.env.API_URL ?? "http://localhost:3001";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const rule = findRouteRule(request.nextUrl.pathname);
  if (!rule) {
    return NextResponse.next();
  }

  const session = await fetchSession(API_BASE_URL, request.headers.get("cookie") ?? undefined);
  const access = evaluateAccess(session, rule.roles);

  if (access.kind === "redirect") {
    return NextResponse.redirect(new URL(access.to, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
