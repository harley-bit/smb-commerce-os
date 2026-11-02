import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, uploadConditionPhoto } from "./conditionPhotoUpload.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const photo = { contentType: "image/jpeg", bytesBase64: "aGVsbG8=" }; // "hello"

describe("base64ToBytes — decodes without Buffer/atob", () => {
  it("round-trips known base64 to the exact byte values", () => {
    expect(Array.from(base64ToBytes("aGVsbG8="))).toEqual([104, 101, 108, 108, 111]);
  });

  it("handles input with no padding needed", () => {
    expect(Array.from(base64ToBytes("aGVsbG8h"))).toEqual([104, 101, 108, 108, 111, 33]);
  });
});

describe("uploadConditionPhoto — mobile's D150 camera-capture upload (docs/cards/D150.md)", () => {
  it("requests a grant, hashes the exact bytes, then confirms with hash + metadata", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(init!.body as string), headers: init!.headers as Record<string, string> });
      if (url.endsWith("/media/upload-url")) return jsonResponse({ storageKey: "sk_123" });
      if (url.endsWith("/media/confirm")) return jsonResponse({ id: "cm_1" });
      throw new Error(`unexpected url ${url}`);
    });
    const sha256Hex = vi.fn(async (bytes: Uint8Array) => `hash-of-${bytes.length}-bytes`);

    const result = await uploadConditionPhoto(
      {
        baseUrl: "https://api.example.com",
        fetchFn: fetchFn as unknown as typeof fetch,
        accessToken: "token-abc",
        merchantId: "merchant-1",
        sha256Hex,
        now: () => "2026-09-09T12:00:00.000Z",
      },
      "cr_1",
      photo,
    );

    expect(result).toEqual({ ok: true, storageKey: "sk_123" });
    expect(calls[0].url).toBe("https://api.example.com/condition-reports/cr_1/media/upload-url");
    expect(calls[0].body).toEqual({ contentType: "image/jpeg", bytes: 5 });
    expect(calls[0].headers.authorization).toBe("Bearer token-abc");
    expect(calls[0].headers["x-merchant-id"]).toBe("merchant-1");

    expect(sha256Hex).toHaveBeenCalledTimes(1);
    expect(Array.from(sha256Hex.mock.calls[0][0] as Uint8Array)).toEqual([104, 101, 108, 108, 111]);

    expect(calls[1].url).toBe("https://api.example.com/condition-reports/cr_1/media/confirm");
    expect(calls[1].body).toEqual({
      storageKey: "sk_123",
      contentType: "image/jpeg",
      bytesBase64: "aGVsbG8=",
      declaredSha256: "hash-of-5-bytes",
      capturedAt: "2026-09-09T12:00:00.000Z",
    });
  });

  it("reports an error and never calls confirm when the upload-url grant fails", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 403));
    const sha256Hex = vi.fn(async () => "unused");

    const result = await uploadConditionPhoto(
      { baseUrl: "https://api.example.com", fetchFn: fetchFn as unknown as typeof fetch, accessToken: "t", merchantId: "m1", sha256Hex, now: () => "x" },
      "cr_1",
      photo,
    );

    expect(result).toEqual({ ok: false, error: "Could not attach that photo." });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it("reports an error when confirm fails (e.g. a hash mismatch)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/media/upload-url")) return jsonResponse({ storageKey: "sk_123" });
      return jsonResponse({}, false, 400);
    });

    const result = await uploadConditionPhoto(
      {
        baseUrl: "https://api.example.com",
        fetchFn: fetchFn as unknown as typeof fetch,
        accessToken: "t",
        merchantId: "m1",
        sha256Hex: async () => "h",
        now: () => "x",
      },
      "cr_1",
      photo,
    );

    expect(result).toEqual({ ok: false, error: "Could not attach that photo." });
  });
});
