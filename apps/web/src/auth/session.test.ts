import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSession } from "./session";

describe("fetchSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null without calling the API when there is no cookie header", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchSession("http://api.internal", undefined);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards the raw cookie header to GET /auth/me and never stores the token itself anywhere", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ userId: "u1", email: "owner@example.com", roles: ["OWNER"] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchSession("http://api.internal", "session=abc123");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api.internal/auth/me",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ cookie: "session=abc123" }),
      }),
    );
    expect(result).toEqual({ userId: "u1", email: "owner@example.com", roles: ["OWNER"] });
  });

  it("returns null when the API rejects the session (expired/invalid/revoked token)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not authenticated." }) });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchSession("http://api.internal", "session=stale");

    expect(result).toBeNull();
  });
});
