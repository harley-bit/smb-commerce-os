import { describe, expect, it, vi } from "vitest";
import { createPaymentIntent } from "./fetchPaymentIntent.js";

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("createPaymentIntent — mobile checkout payment (docs/cards/D146.md)", () => {
  it("posts to the payment-intent route with a fresh Idempotency-Key header and returns success on 201", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ clientSecret: "cs_1", amountMinor: 45000, currency: "USD" }, 201));

    const result = await createPaymentIntent(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, generateIdempotencyKey: () => "idem-1" },
      "corner-bike-shop",
      "order-1",
    );

    expect(result).toEqual({ ok: true, amountMinor: 45000, currency: "USD" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/m/corner-bike-shop/checkout/order-1/payment-intent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("idem-1");
    // security check: the request body never carries a card field.
    expect(init.body).toBeUndefined();
  });

  it("returns a declined result on 402 with only the generic message and retry flag, never a raw decline code", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ detail: "Your card was declined.", retryableWithSameMethod: true, code: "insufficient_funds_raw" }, 402),
    );

    const result = await createPaymentIntent(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, generateIdempotencyKey: () => "idem-2" },
      "corner-bike-shop",
      "order-1",
    );

    expect(result).toEqual({ ok: false, kind: "declined", detail: "Your card was declined.", retryableWithSameMethod: true });
  });

  it("returns a generic error result on any other non-ok status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ detail: "Conflict" }, 409));

    const result = await createPaymentIntent(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, generateIdempotencyKey: () => "idem-3" },
      "corner-bike-shop",
      "order-1",
    );

    expect(result).toEqual({ ok: false, kind: "error", message: "Could not complete payment. Please try again." });
  });
});
