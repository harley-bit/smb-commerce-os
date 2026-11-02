import type { MerchantRole } from "./access";

/**
 * Which protected paths require which merchant role (`packages/domain`'s
 * `MerchantRole` matrix — `OWNER`/`ADMIN`/`STAFF`/`READ_ONLY`). Order
 * matters: the first matching rule wins, most-specific first, so
 * `/dashboard/admin` doesn't fall through to the bare `/dashboard` rule.
 */
export interface RouteRule {
  matcher: RegExp;
  roles?: readonly MerchantRole[];
}

export const PROTECTED_ROUTE_RULES: readonly RouteRule[] = [
  { matcher: /^\/dashboard\/admin(?:\/|$)/, roles: ["OWNER", "ADMIN"] },
  { matcher: /^\/dashboard(?:\/|$)/ },
  // Onboarding a brand-new merchant needs no merchant role yet — the
  // caller isn't a member of any merchant until this flow completes.
  { matcher: /^\/onboarding(?:\/|$)/ },
];

export function findRouteRule(pathname: string): RouteRule | undefined {
  return PROTECTED_ROUTE_RULES.find((rule) => rule.matcher.test(pathname));
}
