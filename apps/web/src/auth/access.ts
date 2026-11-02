/**
 * The identity resolved from a verified session, mirroring
 * `AuthIdentity` (`packages/domain/src/auth/AuthProvider.ts`) as returned
 * by `apps/api`'s `GET /auth/me`. Kept as a local shape rather than an
 * import: `apps/web` has no dependency on `@smb-os/domain` and this is the
 * wire contract, not the domain type.
 */
export interface SessionUser {
  userId: string;
  email: string;
  roles: string[];
}

/**
 * Mirrors `packages/domain/src/auth/rbac.ts`'s `MerchantRole` union.
 * Duplicated rather than imported: `apps/web` has no dependency on
 * `@smb-os/domain`, and this is the wire-level role name, not the domain
 * type itself.
 */
export type MerchantRole = "OWNER" | "ADMIN" | "STAFF" | "READ_ONLY";

export type AccessResult = { kind: "allow" } | { kind: "redirect"; to: "/login" | "/403" };

/**
 * Default-deny route guard: no session redirects to `/login`; a session
 * whose roles don't intersect a route's required roles redirects to
 * `/403`. No `requiredRoles` means "any authenticated session may pass."
 */
export function evaluateAccess(session: SessionUser | null, requiredRoles: readonly string[] | undefined): AccessResult {
  if (!session) {
    return { kind: "redirect", to: "/login" };
  }
  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.some((role) => session.roles.includes(role))) {
    return { kind: "redirect", to: "/403" };
  }
  return { kind: "allow" };
}
