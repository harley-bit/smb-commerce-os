/**
 * `docs/cards/D149.md` — read caching, offline-tolerant reads, no offline
 * writes. Wraps the same `fetchFn: typeof fetch` seam every `apps/mobile`
 * fetch* module already takes (`../merchant/fetchMerchantHome.ts` etc.), so
 * every existing read call becomes offline-tolerant for free once this is
 * composed into `deps.fetchFn` at the app's DI root — none of those
 * modules change.
 *
 * GET: on success, the body is cached by URL; on a thrown network error
 * (this codebase's DI convention for "offline" — see `../auth/authClient.ts`),
 * the last cached body for that URL is replayed instead. A GET that has
 * never succeeded still throws — there is nothing to serve.
 *
 * Everything else (POST/PUT/PATCH/DELETE) never touches the cache in
 * either direction and, on a thrown network error, fails with a distinct
 * `OfflineWriteError` rather than an ambiguous raw network error — this
 * card's security check ("offline writes explicitly out of scope") answered
 * by construction: a write that can't reach the server is never queued,
 * retried, or silently dropped, it fails immediately and identifiably.
 */
export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface OfflineAwareFetchDeps {
  fetchFn: typeof fetch;
  cache: KeyValueCache;
}

export class OfflineWriteError extends Error {
  constructor(method: string) {
    super(`Cannot ${method} while offline — writes require a network connection.`);
    this.name = "OfflineWriteError";
  }
}

interface CachedResponse {
  status: number;
  body: string;
}

export function createOfflineAwareFetch(deps: OfflineAwareFetchDeps): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const cacheKey = input.toString();

    if (method !== "GET") {
      try {
        return await deps.fetchFn(input, init);
      } catch {
        throw new OfflineWriteError(method);
      }
    }

    try {
      const response = await deps.fetchFn(input, init);
      if (response.ok) {
        const body = await response.clone().text();
        await deps.cache.set(cacheKey, JSON.stringify({ status: response.status, body } satisfies CachedResponse));
      }
      return response;
    } catch (error) {
      const cached = await deps.cache.get(cacheKey);
      if (cached === null) throw error;
      const { status, body } = JSON.parse(cached) as CachedResponse;
      return new Response(body, { status });
    }
  }) as typeof fetch;
}
