import { describe, expect, it, vi } from "vitest";
import { fetchServiceDetail } from "./fetchServiceDetail.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const serviceDetail = {
  id: "listing-1",
  mode: "SERVICE",
  name: "Haircut",
  slug: "haircut",
  description: "A classic cut.",
  resourceIds: ["resource-1"],
};

describe("fetchServiceDetail — mobile service listing detail fetch (docs/cards/D143.md)", () => {
  it("fetches and validates a SERVICE listing detail against @smb-os/contracts", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/v1/m/corner-salon/listings/haircut") return jsonResponse(serviceDetail);
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchServiceDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "haircut",
    );

    expect(result).toEqual({ ok: true, detail: serviceDetail });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // security check: every call is a fresh, uncached fetch — never reads stale availability.
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
  });

  it("reports not-found when the server responds non-ok (unknown slug)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 404));

    const result = await fetchServiceDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "no-such-listing",
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports wrong-mode when the listing is not a SERVICE (e.g. PRODUCT)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ id: "l1", mode: "PRODUCT", name: "Trail Bike", slug: "trail-bike", description: null, variants: [] }),
    );

    const result = await fetchServiceDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "trail-bike",
    );

    expect(result).toEqual({ ok: false, reason: "wrong-mode" });
  });

  it("reports invalid when the SERVICE payload fails contract validation", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "l1", mode: "SERVICE", name: "", slug: "x", description: null, resourceIds: [] }));

    const result = await fetchServiceDetail(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch },
      "corner-salon",
      "x",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
