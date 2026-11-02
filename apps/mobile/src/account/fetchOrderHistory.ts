export type OrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

export interface OrderHistorySummary {
  id: string;
  status: string;
  currency: string;
  totalMinor: number;
  placedAt: string | null;
  modes: OrderLineMode[];
}

export interface OrderHistory {
  upcoming: OrderHistorySummary[];
  past: OrderHistorySummary[];
}

export interface FetchOrderHistoryDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  accessToken: string | null;
}

export type FetchOrderHistoryResult =
  | { ok: true; history: OrderHistory }
  | { ok: false; reason: "unauthenticated" | "not-found" | "error" };

/**
 * `docs/cards/D147.md` — mobile's "order history and upcoming" fetch,
 * mirroring `apps/web/src/app/m/[slug]/account/orders/OrderHistoryView.tsx`'s
 * call to `GET /v1/m/{slug}/account/orders`. Web authenticates via its
 * `session` httpOnly cookie (`credentials: "include"`); a mobile app has no
 * cookie jar, so this presents the access token `../auth/secureTokenStore.ts`
 * holds as an `Authorization: Bearer` header instead — the exact split
 * `apps/api/src/auth/sessionToken.ts`'s `extractSessionToken` exists to
 * resolve on the server side (this card's own fix: `customerOrders.ts`
 * previously read only the cookie, which would have made every mobile call
 * here 401 regardless of how correct this client is).
 *
 * This card's acceptance criterion ("only own orders returned") and
 * security check ("ownership enforced server-side, not by client filter")
 * both hold by construction: this module sends no customer identifier at
 * all — the server derives it entirely from the bearer token's own session
 * identity (`CustomerOrderHistoryService.listOrderHistory`), so there is no
 * client-side filter to bypass.
 */
export async function fetchOrderHistory(deps: FetchOrderHistoryDeps, slug: string): Promise<FetchOrderHistoryResult> {
  if (!deps.accessToken) {
    return { ok: false, reason: "unauthenticated" };
  }

  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/account/orders`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${deps.accessToken}` },
  });

  if (response.status === 401) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (response.status === 404) {
    return { ok: false, reason: "not-found" };
  }
  if (!response.ok) {
    return { ok: false, reason: "error" };
  }

  const history = (await response.json()) as OrderHistory;
  return { ok: true, history };
}
