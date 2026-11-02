import { describe, expect, it } from "vitest";
import { findRouteRule } from "./routeRules";

describe("findRouteRule", () => {
  it("requires OWNER or ADMIN for /dashboard/admin and its subpaths", () => {
    expect(findRouteRule("/dashboard/admin")?.roles).toEqual(["OWNER", "ADMIN"]);
    expect(findRouteRule("/dashboard/admin/users")?.roles).toEqual(["OWNER", "ADMIN"]);
  });

  it("requires only an authenticated session (no role restriction) for plain /dashboard paths", () => {
    expect(findRouteRule("/dashboard")?.roles).toBeUndefined();
    expect(findRouteRule("/dashboard/orders")?.roles).toBeUndefined();
  });

  it("requires only an authenticated session (no role restriction) for /onboarding", () => {
    expect(findRouteRule("/onboarding")?.roles).toBeUndefined();
    expect(findRouteRule("/onboarding")).toBeDefined();
  });

  it("matches nothing outside the protected prefixes", () => {
    expect(findRouteRule("/login")).toBeUndefined();
    expect(findRouteRule("/")).toBeUndefined();
  });
});
