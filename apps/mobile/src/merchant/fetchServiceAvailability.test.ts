import { describe, expect, it, vi } from "vitest";
import { fetchServiceAvailability } from "./fetchServiceAvailability.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("fetchServiceAvailability — mobile slot picker fetch (docs/cards/D143.md)", () => {
  it("fetches and returns the server's free intervals verbatim", async () => {
    const free = [
      { start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" },
      { start: "2026-09-10T11:00:00.000Z", end: "2026-09-10T12:00:00.000Z" },
    ];
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.example.com/v1/m/corner-salon/availability?resourceId=resource-1&from=2026-09-10T00%3A00%3A00.000Z&to=2026-09-24T00%3A00%3A00.000Z",
      );
      return jsonResponse({ free });
    });

    const result = await fetchServiceAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "resource-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: true, free });
    // security check: only free/busy intervals ever leave the server — this
    // helper passes the response through verbatim, and the response shape
    // itself (`{ free: Interval[] }`, apps/api/src/routes/availability.ts)
    // never carries a reservation id or customer name.
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
  });

  it("reports an error when the server responds non-ok", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchServiceAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "resource-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: false });
  });

  it("reports an error when the response body has no free array", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));

    const result = await fetchServiceAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "resource-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: false });
  });
});
