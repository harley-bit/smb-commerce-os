/**
 * RBAC role matrix per `docs/design/07`'s "Authorization" section: merchant
 * roles only (`OWNER`/`ADMIN`/`STAFF`/`READ_ONLY` — the same literal set as
 * `packages/db`'s `MerchantUserRole`, kept independent here since domain
 * code cannot depend on `packages/db`). Platform roles
 * (`PLATFORM_SUPERADMIN`/`PLATFORM_ADMIN`/`PLATFORM_SUPPORT`) are a separate
 * axis per that doc and out of scope for this matrix.
 *
 * Default deny: `ROLE_ACTIONS` is the only source of "yes" — any action not
 * explicitly listed for a role, including an action string outside the
 * `MerchantAction` union entirely, resolves to `false`/throws. There is no
 * fallback "allow" path.
 */

export type MerchantRole = "OWNER" | "ADMIN" | "STAFF" | "READ_ONLY";

export type MerchantAction =
  | "catalog:view"
  | "catalog:manage"
  | "inventory:view"
  | "inventory:manage"
  | "bookings:view"
  | "bookings:manage"
  | "condition_reports:manage"
  | "reports:view"
  | "payments:refund"
  | "payouts:manage"
  | "roles:assign";

/** The minimal shape `assertCan` needs from a caller's authorization context. */
export interface AuthorizationContext {
  role: MerchantRole;
}

export class ForbiddenActionError extends Error {
  constructor(
    public readonly role: MerchantRole,
    public readonly action: MerchantAction,
    public readonly resource?: string,
  ) {
    super(
      `Role ${role} is not permitted to perform "${action}"${resource ? ` on ${resource}` : ""}.`,
    );
    this.name = "ForbiddenActionError";
  }
}

const READ_ONLY_ACTIONS: readonly MerchantAction[] = [
  "catalog:view",
  "inventory:view",
  "bookings:view",
  "reports:view",
];

const STAFF_ACTIONS: readonly MerchantAction[] = [
  "catalog:view",
  "inventory:view",
  "bookings:view",
  "bookings:manage",
  "condition_reports:manage",
];

const ADMIN_ACTIONS: readonly MerchantAction[] = [
  "catalog:view",
  "catalog:manage",
  "inventory:view",
  "inventory:manage",
  "bookings:view",
  "bookings:manage",
  "condition_reports:manage",
  "reports:view",
  "payments:refund",
];

const OWNER_ACTIONS: readonly MerchantAction[] = [...ADMIN_ACTIONS, "payouts:manage", "roles:assign"];

const ROLE_ACTIONS: Readonly<Record<MerchantRole, ReadonlySet<MerchantAction>>> = {
  OWNER: new Set(OWNER_ACTIONS),
  ADMIN: new Set(ADMIN_ACTIONS),
  STAFF: new Set(STAFF_ACTIONS),
  READ_ONLY: new Set(READ_ONLY_ACTIONS),
};

/** Pure predicate — never throws. */
export function can(role: MerchantRole, action: MerchantAction): boolean {
  return ROLE_ACTIONS[role].has(action);
}

/**
 * The single `assertCan(ctx, action, resource)` call `docs/design/07`
 * requires at the top of every service method. Throws `ForbiddenActionError`
 * for anything `can()` doesn't explicitly allow.
 */
export function assertCan(ctx: AuthorizationContext, action: MerchantAction, resource?: string): void {
  if (!can(ctx.role, action)) {
    throw new ForbiddenActionError(ctx.role, action, resource);
  }
}
