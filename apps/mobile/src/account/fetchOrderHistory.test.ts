import { describe, expect, it, vi } from "vitest";
import { fetchOrderHistory } from "./fetchOrderHistory.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

const history = {
  upcoming: [{ id: "order-1", status: "PENDING_PAYMENT", currency: "USD", totalMinor: 500, placedAt: null, modes: ["SERVICE"] }],
  past: [{ id: "order-2", status: "COMPLETED", currency: "USD", totalMinor: 1200, placedAt: "2026-01-01T00:00:00.000Z", modes: ["PRODUCT"] }],
};

describe("fetchOrderHistory — mobile order history fetch (docs/cards/D147.md)", () => {
  it("presents the access token as an Authorization: Bearer header, not a cookie — mobile has no cookie jar", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/v1/m/corner-salon/account/orders");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
      expect(init?.cache).toBe("no-store");
      return jsonResponse(history);
    });

    const result = await fetchOrderHistory(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "corner-salon",
    );

    expect(result).toEqual({ ok: true, history });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports unauthenticated without ever calling the network when there is no access token", async () => {
    const fetchFn = vi.fn();

    const result = await fetchOrderHistory(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: null },
      "corner-salon",
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports unauthenticated when the server rejects an expired/invalid token", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 401));

    const result = await fetchOrderHistory(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "stale" },
      "corner-salon",
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("reports not-found for an unknown merchant slug", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 404));

    const result = await fetchOrderHistory(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "no-such-merchant",
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports a generic error on any other non-ok response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 500));

    const result = await fetchOrderHistory(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "token-abc" },
      "corner-salon",
    );

    expect(result).toEqual({ ok: false, reason: "error" });
  });
});
