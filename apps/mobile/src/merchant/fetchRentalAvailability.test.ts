import { describe, expect, it, vi } from "vitest";
import { fetchRentalAvailability } from "./fetchRentalAvailability.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("fetchRentalAvailability — mobile rental date-range check (docs/cards/D144.md)", () => {
  it("fetches and returns the server's available boolean verbatim", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.example.com/v1/m/corner-shop/listings/mountain-bike/rental-availability?variantId=variant-1&from=2026-09-10T00%3A00%3A00.000Z&to=2026-09-12T00%3A00%3A00.000Z",
      );
      return jsonResponse({ available: true });
    });

    const result = await fetchRentalAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "mountain-bike",
      "variant-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-12T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: true, available: true });
    // security check: no reservation id, unit id, or customer data ever leaves
    // the server here — only a bare boolean, passed through verbatim.
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
  });

  it("reports an error when the server responds non-ok", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchRentalAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "mountain-bike",
      "variant-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-12T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: false });
  });

  it("reports an error when the response body has no available boolean", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));

    const result = await fetchRentalAvailability(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "mountain-bike",
      "variant-1",
      "2026-09-10T00:00:00.000Z",
      "2026-09-12T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: false });
  });
});
