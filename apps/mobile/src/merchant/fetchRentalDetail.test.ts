import { describe, expect, it, vi } from "vitest";
import { fetchRentalDetail } from "./fetchRentalDetail.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const rentalDetail = {
  id: "listing-1",
  mode: "RENTAL",
  name: "Mountain Bike",
  slug: "mountain-bike",
  description: "A sturdy trail bike.",
  variants: [
    {
      id: "variant-1",
      sku: "MB-1",
      name: "Standard",
      priceMinor: 2500,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 10000,
    },
  ],
};

describe("fetchRentalDetail — mobile rental listing detail fetch (docs/cards/D144.md)", () => {
  it("fetches and validates a RENTAL listing detail against @smb-os/contracts", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/v1/m/corner-shop/listings/mountain-bike") return jsonResponse(rentalDetail);
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchRentalDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "mountain-bike",
    );

    expect(result).toEqual({ ok: true, detail: rentalDetail });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // security check: every call is a fresh, uncached fetch — never reads stale deposit terms.
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
  });

  it("reports not-found when the server responds non-ok (unknown slug)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchRentalDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "no-such-listing",
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports wrong-mode when the listing is not a RENTAL (e.g. SERVICE)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ id: "l1", mode: "SERVICE", name: "Haircut", slug: "haircut", description: null, resourceIds: [] }),
    );

    const result = await fetchRentalDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "haircut",
    );

    expect(result).toEqual({ ok: false, reason: "wrong-mode" });
  });

  it("reports invalid when the RENTAL payload fails contract validation", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ id: "l1", mode: "RENTAL", name: "", slug: "x", description: null, variants: [] }),
    );

    const result = await fetchRentalDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-shop",
      "x",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
