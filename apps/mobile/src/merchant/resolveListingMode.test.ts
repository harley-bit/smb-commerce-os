import { describe, expect, it, vi } from "vitest";
import { resolveListingMode } from "./resolveListingMode.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("resolveListingMode — mobile mode dispatch for ListingDetail (docs/cards/D143.md)", () => {
  it("reports the listing's mode when the response is ok", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "l1", mode: "SERVICE", name: "Haircut", slug: "haircut", description: null }));

    const result = await resolveListingMode(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "haircut",
    );

    expect(result).toEqual({ ok: true, mode: "SERVICE" });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/v1/m/corner-salon/listings/haircut",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reports not-found when the server responds non-ok", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await resolveListingMode(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "no-such-listing",
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports invalid when the response has no recognizable mode field", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "l1" }));

    const result = await resolveListingMode(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "x",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
