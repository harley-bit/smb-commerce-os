# API Contracts and Service Boundaries

## Shape

A single REST API over HTTPS, JSON, versioned at `/v1`. Consumed by the web app, the mobile app, and — later — partners.

**Not GraphQL.** The access patterns are known and narrow, and GraphQL's flexibility works against tenant-scoping guarantees: every resolver becomes a place where a scope check can be forgotten. A fixed REST surface has a fixed, auditable set of entry points.

**Not tRPC**, despite the TypeScript stack. tRPC couples clients to server internals, which is wrong for a mobile app shipped through app stores and versioned independently of the server. Types are shared through generated clients from the Zod contracts instead — the same benefit without the coupling.

## Internal layering

```
HTTP route  →  Controller  →  Service  →  Repository  →  Database
                    ↑            ↑
              Zod validation   Domain
                               (invariants, state machines)
```

Rules, enforced by lint rules and code review:

1. **Controllers contain no business logic.** Parse, authorize, call one service method, serialize.
2. **Services own invariants and transactions.** A transaction begins and ends inside a service method, never spanning two.
3. **Repositories are the only code that touches the database**, and every method takes a tenant context as its first argument.
4. **`/packages/domain` has no I/O.** State machines and conflict detection are pure functions, unit-testable without infrastructure.

The layering exists so that tenant scoping and invariants have exactly one place to live. A controller that queries the database directly is the bug that leaks another merchant's data.

## Tenant context

Every authenticated request resolves to a `TenantContext { userId, merchantId, role }` before reaching a controller. Repository methods take it explicitly:

```ts
findListings(ctx: TenantContext, filter: ListingFilter): Promise<Listing[]>
```

Passed explicitly rather than through ambient/async-local storage, deliberately. An explicit argument cannot be silently absent — a missing scope is a compile error, not a runtime data leak. The cost is verbosity; the benefit is that invariant I1 is checked by the type system.

## Versioning

- URL-versioned: `/v1/...`.
- Additive changes (new optional field, new endpoint) do not bump the version.
- Breaking changes require `/v2` running alongside `/v1` for a deprecation window — mobile clients cannot be force-upgraded.
- Every response includes `X-API-Version`.

## Conventions

| Concern | Convention |
|---|---|
| Auth | `Authorization: Bearer <token>` |
| Errors | RFC 9457 problem details: `type`, `title`, `status`, `detail`, `instance` |
| Money | `{ "amount_minor": 4500, "currency": "USD" }` — never a decimal string |
| Timestamps | ISO-8601 UTC with `Z` |
| Pagination | Cursor-based: `?limit=&cursor=`, returns `next_cursor` |
| Idempotency | `Idempotency-Key` header **required** on all POSTs that move money or create reservations |
| Rate limits | Per-token and per-IP; `429` with `Retry-After` |
| Correlation | `X-Request-Id` accepted or generated; present in every log line |

**Idempotency is not optional on reservation and payment creation.** A mobile client on a poor connection retries; without an idempotency key, a retry creates a second reservation or a second charge.

## Error codes

Domain errors map to stable machine-readable types, not just HTTP statuses:

| Type | Status | Meaning |
|---|---|---|
| `reservation/conflict` | 409 | The interval is no longer available |
| `reservation/hold-expired` | 410 | The cart hold timed out |
| `inventory/insufficient-stock` | 409 | Not enough stock |
| `inventory/unit-unavailable` | 409 | Unit is sold, retired, or reserved |
| `rental/checkout-report-required` | 422 | Cannot start a rental without a condition report |
| `deposit/already-captured` | 409 | One capture per authorization |
| `deposit/window-exceeded` | 422 | Rental period exceeds the authorization ceiling |
| `auth/insufficient-role` | 403 | Authenticated but not permitted |

Clients branch on `type`. Status codes alone are too coarse — a storefront must tell a customer "someone just booked that slot" differently from "you don't have enough stock."

## Endpoint surface (MVP)

**Public storefront** (unauthenticated, read-mostly)
```
GET  /v1/m/{merchantSlug}                     merchant profile
GET  /v1/m/{merchantSlug}/listings            mixed catalog, filter by mode
GET  /v1/m/{merchantSlug}/listings/{id}
GET  /v1/m/{merchantSlug}/availability        ?variantId&from&to  → free intervals
POST /v1/m/{merchantSlug}/carts
POST /v1/m/{merchantSlug}/carts/{id}/lines    creates a HELD reservation for service/rental
POST /v1/m/{merchantSlug}/carts/{id}/checkout returns a payment intent
```

**Customer** (authenticated)
```
GET  /v1/me/orders
GET  /v1/me/orders/{id}
POST /v1/me/orders/{id}/cancel
```

**Merchant** (authenticated, tenant-scoped)
```
GET|POST|PATCH  /v1/merchant/listings[/{id}]
GET|POST|PATCH  /v1/merchant/variants[/{id}]
GET|POST|PATCH  /v1/merchant/inventory-units[/{id}]
POST            /v1/merchant/inventory-units/{id}/movements
GET|POST|PATCH  /v1/merchant/resources[/{id}]
GET|PUT         /v1/merchant/resources/{id}/availability-rules
GET             /v1/merchant/calendar             ?from&to — all modes, one view
GET             /v1/merchant/orders
POST            /v1/merchant/orders/{id}/lines/{lineId}/events   PICKED_UP | RETURNED | NO_SHOW
POST            /v1/merchant/order-lines/{id}/condition-reports
POST            /v1/merchant/condition-reports/{id}/media        signed upload URL
POST            /v1/merchant/order-lines/{id}/damage-claims
POST            /v1/merchant/deposits/{id}/capture
POST            /v1/merchant/deposits/{id}/release
GET             /v1/merchant/settings
```

**Webhooks (inbound)**
```
POST /v1/webhooks/stripe     signature-verified, idempotent by provider event id
```

**Platform**
```
GET  /v1/health              liveness
GET  /v1/ready               dependencies
```

## The availability endpoint

The most performance-sensitive read in the system, and the one most likely to be abused.

```
GET /v1/m/{slug}/availability?variantId=...&from=...&to=...&granularity=DAY|SLOT
```

Returns free intervals, computed from availability rules, minus exceptions, minus blocking reservations. Constraints: window capped at 90 days per request; results cached for a short TTL keyed on `(variantId, from, to)` and invalidated on any reservation write for that subject; unauthenticated, so rate-limited per IP.

**It never reveals who booked a slot** — only that it is unavailable. Leaking customer information through an availability response is a privacy defect and is explicitly tested.

## Webhook handling

1. Verify the provider signature before parsing. An unverified webhook is discarded and logged as a security event.
2. Look up `payments.provider_ref` for the event ID. If present, return 200 without reprocessing.
3. Process inside a transaction; persist the raw event JSON.
4. Return 200 quickly; do slow work asynchronously.

Providers retry aggressively and deliver out of order. Idempotency and ordering-tolerance are requirements, not refinements.

## Contract testing

Zod schemas in `/packages/contracts` are the single source of truth. From them: runtime validation at the API boundary, TypeScript types for web and mobile, and a generated OpenAPI document.

CI fails if a route's runtime validation and its published schema diverge. This is what prevents the documented API and the real API drifting apart.
