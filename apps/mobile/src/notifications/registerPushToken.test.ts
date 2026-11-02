import { describe, expect, it, vi } from "vitest";
import { registerPushToken } from "./registerPushToken.js";

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe("registerPushToken — mobile device push-token registration (docs/cards/D148.md)", () => {
  it("presents the access token as an Authorization: Bearer header and the device's own platform/token", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/v1/m/corner-salon/account/push-tokens");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
      expect(JSON.parse(init?.body as string)).toEqual({ platform: "ios", token: "device-token-1" });
      return response(204);
    });

    const result = await registerPushToken(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "corner-salon",
      { platform: "ios", token: "device-token-1" },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("registers an Android device through the exact same call shape — no platform-specific branching", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ platform: "android", token: "device-token-2" });
      return response(204);
    });

    const result = await registerPushToken(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "corner-salon",
      { platform: "android", token: "device-token-2" },
    );

    expect(result).toEqual({ ok: true });
  });

  it("reports unauthenticated without ever calling the network when there is no access token", async () => {
    const fetchFn = vi.fn();

    const result = await registerPushToken(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: null },
      "corner-salon",
      { platform: "ios", token: "device-token-1" },
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports unauthenticated when the server rejects an expired/invalid token", async () => {
    const fetchFn = vi.fn(async () => response(401));

    const result = await registerPushToken(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "stale" },
      "corner-salon",
      { platform: "ios", token: "device-token-1" },
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("reports a generic error on any other non-ok response", async () => {
    const fetchFn = vi.fn(async () => response(500));

    const result = await registerPushToken(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "corner-salon",
      { platform: "ios", token: "device-token-1" },
    );

    expect(result).toEqual({ ok: false, reason: "error" });
  });
});
