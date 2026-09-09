import { describe, expect, it, vi } from "vitest";
import { fetchMerchantHome } from "./fetchMerchantHome.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const profile = { name: "Corner Bike Shop", slug: "corner-bike-shop", defaultCurrency: "USD" };

describe("fetchMerchantHome — mobile Home screen's profile fetch (docs/cards/D140.md, D141.md)", () => {
  it("fetches the merchant profile and validates it against @smb-os/contracts", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/v1/m/corner-bike-shop") return jsonResponse(profile);
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchMerchantHome({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch }, "corner-bike-shop");

    expect(result).toEqual({ ok: true, profile });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports an error when the merchant profile request fails (unknown slug)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchMerchantHome({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch }, "no-such-merchant");

    expect(result).toEqual({ ok: false, error: "Could not find that merchant." });
  });

  it("reports an error when the profile payload fails contract validation", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ name: "", slug: "x", defaultCurrency: "USD" }));

    const result = await fetchMerchantHome({ baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch }, "x");

    expect(result.ok).toBe(false);
  });
});
