import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

function makeRequest(pathname: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new NextRequest(new Request(`http://localhost:3000${pathname}`, { headers }));
}

describe("middleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects unauthenticated access to a protected route to /login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not authenticated." }) }),
    );

    const response = await middleware(makeRequest("/dashboard"));

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets an authenticated STAFF session through the plain dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "u1", email: "staff@example.com", roles: ["STAFF"] }),
      }),
    );

    const response = await middleware(makeRequest("/dashboard", "session=abc"));

    expect(response?.status).toBe(200);
  });

  it("redirects an authenticated STAFF session away from the admin-only area (role gate)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "u1", email: "staff@example.com", roles: ["STAFF"] }),
      }),
    );

    const response = await middleware(makeRequest("/dashboard/admin", "session=abc"));

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/403");
  });

  it("lets an authenticated OWNER session into the admin-only area", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "u2", email: "owner@example.com", roles: ["OWNER"] }),
      }),
    );

    const response = await middleware(makeRequest("/dashboard/admin", "session=abc"));

    expect(response?.status).toBe(200);
  });

  it("does not touch unprotected routes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await middleware(makeRequest("/login"));

    expect(response?.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets a strict, nonce-based CSP header on every response, including unprotected routes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await middleware(makeRequest("/login"));
    const csp = response?.headers.get("content-security-policy");

    expect(csp).toBeTruthy();
    expect(csp?.toLowerCase()).not.toContain("unsafe-inline");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it("sets a fresh nonce per request, never reusing one across calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not authenticated." }) }),
    );

    const first = await middleware(makeRequest("/dashboard"));
    const second = await middleware(makeRequest("/dashboard"));

    expect(first?.headers.get("x-nonce")).toBeTruthy();
    expect(first?.headers.get("x-nonce")).not.toBe(second?.headers.get("x-nonce"));
  });
});
