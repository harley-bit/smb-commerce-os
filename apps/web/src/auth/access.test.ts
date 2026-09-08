import { describe, expect, it } from "vitest";
import { evaluateAccess, type SessionUser } from "./access";

const owner: SessionUser = { userId: "u1", email: "owner@example.com", roles: ["OWNER"] };
const staff: SessionUser = { userId: "u2", email: "staff@example.com", roles: ["STAFF"] };

describe("evaluateAccess", () => {
  it("redirects to /login when there is no session (unauthenticated access)", () => {
    expect(evaluateAccess(null, undefined)).toEqual({ kind: "redirect", to: "/login" });
  });

  it("allows an authenticated session through a route with no role requirement", () => {
    expect(evaluateAccess(staff, undefined)).toEqual({ kind: "allow" });
  });

  it("allows an authenticated session whose role is in the required set", () => {
    expect(evaluateAccess(owner, ["OWNER", "ADMIN"])).toEqual({ kind: "allow" });
  });

  it("redirects to /403 when the session's role is not in the required set (role gate)", () => {
    expect(evaluateAccess(staff, ["OWNER", "ADMIN"])).toEqual({ kind: "redirect", to: "/403" });
  });

  it("defaults deny: an empty roles array on the session never satisfies a role requirement", () => {
    const noRoles: SessionUser = { userId: "u3", email: "none@example.com", roles: [] };
    expect(evaluateAccess(noRoles, ["OWNER"])).toEqual({ kind: "redirect", to: "/403" });
  });
});
