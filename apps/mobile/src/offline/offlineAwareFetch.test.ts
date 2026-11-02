import { describe, expect, it, vi } from "vitest";
import { createOfflineAwareFetch, OfflineWriteError, type KeyValueCache } from "./offlineAwareFetch.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function inMemoryCache(): KeyValueCache {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
  };
}

describe("createOfflineAwareFetch (docs/cards/D149.md) — cached reads, writes fail clearly offline", () => {
  it("passes a successful GET straight through and caches the body", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ hello: "world" }));
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache: inMemoryCache() });

    const response = await offlineFetch("https://api.example.com/v1/m/x");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serves the last cached GET response when the network call throws (offline)", async () => {
    const cache = inMemoryCache();
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse({ hello: "world" }))
      .mockImplementationOnce(async () => {
        throw new TypeError("Network request failed");
      });
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache });

    await offlineFetch("https://api.example.com/v1/m/x");
    const response = await offlineFetch("https://api.example.com/v1/m/x");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world" });
  });

  it("rethrows when offline and nothing has ever been cached for that GET", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache: inMemoryCache() });

    await expect(offlineFetch("https://api.example.com/v1/m/x")).rejects.toThrow();
  });

  it("throws a clearly-typed OfflineWriteError for a POST when the network call fails — never a queued/silent write", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache: inMemoryCache() });

    await expect(offlineFetch("https://api.example.com/v1/m/x/checkout", { method: "POST" })).rejects.toThrow(
      OfflineWriteError,
    );
  });

  it("never reads or writes the cache for a write request", async () => {
    const cache = inMemoryCache();
    const setSpy = vi.spyOn(cache, "set");
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache });

    await offlineFetch("https://api.example.com/v1/m/x/checkout", { method: "POST" });

    expect(setSpy).not.toHaveBeenCalled();
  });

  it("passes a successful write straight through when online", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }, 201));
    const offlineFetch = createOfflineAwareFetch({ fetchFn: fetchFn as unknown as typeof fetch, cache: inMemoryCache() });

    const response = await offlineFetch("https://api.example.com/v1/m/x/checkout", { method: "POST" });

    expect(response.status).toBe(201);
  });
});
