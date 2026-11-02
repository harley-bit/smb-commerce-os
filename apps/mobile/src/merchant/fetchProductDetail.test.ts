import { describe, expect, it, vi } from "vitest";
import { fetchProductDetail } from "./fetchProductDetail.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const productDetail = {
  id: "listing-1",
  mode: "PRODUCT",
  name: "Trail Bike",
  slug: "trail-bike",
  description: "A sturdy trail bike.",
  variants: [
    { id: "v1", sku: "TB-1", name: "Standard", priceMinor: 45000, currency: "USD", attributesJson: null, stockStatus: "IN_STOCK" },
  ],
};

describe("fetchProductDetail — mobile product listing detail fetch (docs/cards/D142.md)", () => {
  it("fetches and validates a PRODUCT listing detail against @smb-os/contracts", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/v1/m/corner-bike-shop/listings/trail-bike") return jsonResponse(productDetail);
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchProductDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      "trail-bike",
    );

    expect(result).toEqual({ ok: true, detail: productDetail });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // security check: every call is a fresh, uncached fetch — never reads a stale price.
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
  });

  it("reports not-found when the server responds non-ok (unknown slug)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchProductDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      "no-such-listing",
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports wrong-mode when the listing is not a PRODUCT (e.g. SERVICE)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "l1", mode: "SERVICE", name: "Haircut", slug: "haircut", description: null, resourceIds: [] }));

    const result = await fetchProductDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      "haircut",
    );

    expect(result).toEqual({ ok: false, reason: "wrong-mode" });
  });

  it("reports invalid when the PRODUCT payload fails contract validation", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "l1", mode: "PRODUCT", name: "", slug: "x", description: null, variants: [] }));

    const result = await fetchProductDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-bike-shop",
      "x",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
