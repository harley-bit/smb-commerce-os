import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenActionError, type MerchantAction, type MerchantRole } from "./rbac.js";

const ALL_ROLES: MerchantRole[] = ["OWNER", "ADMIN", "STAFF", "READ_ONLY"];
const ALL_ACTIONS: MerchantAction[] = [
  "catalog:view",
  "catalog:manage",
  "inventory:view",
  "inventory:manage",
  "bookings:view",
  "bookings:manage",
  "condition_reports:manage",
  "reports:view",
  "payouts:manage",
  "roles:assign",
];

describe("rbac role matrix", () => {
  it("OWNER can do everything, including payouts and role assignment", () => {
    for (const action of ALL_ACTIONS) {
      expect(can("OWNER", action)).toBe(true);
    }
  });

  it("ADMIN can operate the business but not touch payouts or role assignment", () => {
    const permitted: MerchantAction[] = [
      "catalog:view",
      "catalog:manage",
      "inventory:view",
      "inventory:manage",
      "bookings:view",
      "bookings:manage",
      "condition_reports:manage",
      "reports:view",
    ];
    const forbidden: MerchantAction[] = ["payouts:manage", "roles:assign"];
    for (const action of permitted) {
      expect(can("ADMIN", action)).toBe(true);
    }
    for (const action of forbidden) {
      expect(can("ADMIN", action)).toBe(false);
    }
  });

  it("STAFF can handle bookings and condition reports but not manage catalog/inventory or payouts/roles", () => {
    const permitted: MerchantAction[] = [
      "catalog:view",
      "inventory:view",
      "bookings:view",
      "bookings:manage",
      "condition_reports:manage",
    ];
    const forbidden: MerchantAction[] = [
      "catalog:manage",
      "inventory:manage",
      "reports:view",
      "payouts:manage",
      "roles:assign",
    ];
    for (const action of permitted) {
      expect(can("STAFF", action)).toBe(true);
    }
    for (const action of forbidden) {
      expect(can("STAFF", action)).toBe(false);
    }
  });

  it("READ_ONLY can view but never manage or mutate anything", () => {
    const permitted: MerchantAction[] = ["catalog:view", "inventory:view", "bookings:view", "reports:view"];
    const forbidden: MerchantAction[] = [
      "catalog:manage",
      "inventory:manage",
      "bookings:manage",
      "condition_reports:manage",
      "payouts:manage",
      "roles:assign",
    ];
    for (const action of permitted) {
      expect(can("READ_ONLY", action)).toBe(true);
    }
    for (const action of forbidden) {
      expect(can("READ_ONLY", action)).toBe(false);
    }
  });

  it("default-denies an action that isn't in the matrix at all, for every role", () => {
    const unlistedAction = "impersonate:platform_admin" as MerchantAction;
    for (const role of ALL_ROLES) {
      expect(can(role, unlistedAction)).toBe(false);
    }
  });

  it("assertCan does not throw for a permitted action", () => {
    expect(() => assertCan({ role: "OWNER" }, "roles:assign")).not.toThrow();
  });

  it("assertCan throws ForbiddenActionError, naming the role and action, for a forbidden action", () => {
    expect(() => assertCan({ role: "STAFF" }, "payouts:manage", "merchant-123")).toThrow(ForbiddenActionError);
    try {
      assertCan({ role: "STAFF" }, "payouts:manage", "merchant-123");
      throw new Error("expected assertCan to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenActionError);
      const forbidden = error as ForbiddenActionError;
      expect(forbidden.role).toBe("STAFF");
      expect(forbidden.action).toBe("payouts:manage");
      expect(forbidden.resource).toBe("merchant-123");
    }
  });

  it("assertCan default-denies an unlisted action for every role, including OWNER", () => {
    const unlistedAction = "impersonate:platform_admin" as MerchantAction;
    for (const role of ALL_ROLES) {
      expect(() => assertCan({ role }, unlistedAction)).toThrow(ForbiddenActionError);
    }
  });
});
