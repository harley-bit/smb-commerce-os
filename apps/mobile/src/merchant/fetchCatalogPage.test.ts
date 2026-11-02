import { describe, expect, it, vi } from "vitest";
import { fetchCatalogPage } from "./fetchCatalogPage.js";

function jsonResponse(body: unknown, ok = true, status = 200, nextCursor: string | null = null): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => (name === "X-Next-Cursor" ? nextCursor : null) },
  } as unknown as Response;
}

const listings = [{ id: "l1", mode: "PRODUCT", name: "Trail bike", slug: "trail-bike", description: null }];

describe("fetchCatalogPage — mobile catalog browse pagination (docs/cards/D141.md)", () => {
  it("requests a page with mode/cursor/limit and returns the next cursor", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.example.com/v1/m/corner-bike-shop/listings?mode=PRODUCT&cursor=l0&limit=10");
      return jsonResponse(listings, true, 200, "l1");
    });

    const result = await fetchCatalogPage(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      { mode: "PRODUCT", cursor: "l0", limit: 10 },
    );

    expect(result).toEqual({ ok: true, listings, nextCursor: "l1" });
  });

  it("omits mode/cursor from the querystring when not given (first page, all modes)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.example.com/v1/m/corner-bike-shop/listings?limit=10");
      return jsonResponse(listings);
    });

    await fetchCatalogPage(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      { limit: 10 },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns nextCursor: null on the last page (no X-Next-Cursor header)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(listings, true, 200, null));

    const result = await fetchCatalogPage(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      { limit: 10 },
    );

    expect(result).toEqual({ ok: true, listings, nextCursor: null });
  });

  it("reports an error when the request fails", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 500));

    const result = await fetchCatalogPage(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      { limit: 10 },
    );

    expect(result).toEqual({ ok: false, error: "Could not load the catalog." });
  });

  it("reports an error when the payload fails contract validation", async () => {
    const fetchFn = vi.fn(async () => jsonResponse([{ id: "l1" }]));

    const result = await fetchCatalogPage(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      { limit: 10 },
    );

    expect(result.ok).toBe(false);
  });
});
