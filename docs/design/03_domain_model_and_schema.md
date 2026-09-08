# Domain Model and Schema

## The unifying idea — stated precisely

Products, services, and rentals share a **catalog**, an **order**, and a **checkout**. They differ in how they consume **capacity**:

| Mode    | Capacity mechanism                   | Time interval  | Returns |
| ------- | ------------------------------------ | -------------- | ------- |
| Product | Permanent stock decrement            | None           | No      |
| Service | Resource occupied for a window       | `[start, end)` | No      |
| Rental  | Inventory unit occupied for a window | `[start, end)` | **Yes** |

**Do not force all three into one capacity table.** An earlier framing described rentals as "the general case" with products and services as degenerate versions. That is true conceptually and misleading as a schema: a product sale has no interval and no resource, and modelling it as a zero-length reservation produces a table where half the columns are meaningless for a third of the rows.

The correct design: **unify the catalog and the order; keep three capacity strategies behind one interface.**

```
Listing (mode discriminator)  →  shared
Order / OrderLine             →  shared
CapacityStrategy              →  three implementations
   ├── StockStrategy        (product) → inventory_movements
   ├── ResourceStrategy     (service) → reservations, subject = resource
   └── UnitStrategy         (rental)  → reservations, subject = inventory_unit
```

Services and rentals _do_ share the `reservations` table, because both are "a subject is occupied over an interval." Products do not, because they are not.

## Entity overview

```
merchants ──┬── locations
            ├── merchant_users ── users
            ├── listings ── listing_variants ──┬── inventory_units
            │                                  └── inventory_movements
            ├── resources ── availability_rules
            │             └── availability_exceptions
            ├── orders ── order_lines ──┬── reservations
            │                           ├── fulfillment_events
            │                           ├── condition_reports ── condition_media
            │                           └── damage_claims
            ├── payments ── deposit_authorizations
            └── audit_log
```

## Cross-cutting rules

These apply to every table and are non-negotiable.

1. **`merchant_id` on every tenant-owned table.** No exceptions, including child tables where it is derivable by join. Denormalized deliberately, so tenant scoping is a single predicate at the repository layer and cannot be forgotten in a join.
2. **Money is an integer in minor units.** `amount_minor INTEGER`, never a float, never a decimal string. A `currency CHAR(3)` accompanies every monetary column's owning row.
3. **Time is UTC.** Stored as ISO-8601 text in SQLite, `timestamptz` in PostgreSQL. Local time is a rendering concern; `locations.timezone` (IANA name) drives it.
4. **Intervals are half-open `[starts_at, ends_at)`.** A rental ending at 10:00 and one starting at 10:00 do not overlap. This removes an entire class of off-by-one bugs.
5. **IDs are UUIDv7** — text in SQLite, native `uuid` in PostgreSQL. v7 is time-ordered, which keeps index locality without leaking a sequential count.
6. **Soft delete only where required.** Financial and audit records are never deleted. Catalog objects use `archived_at`.

## Tables

### Tenancy and identity

**`merchants`** — `id`, `name`, `slug` (unique), `status`, `default_currency`, `created_at`, `archived_at`

**`users`** — `id`, `email` (unique, citext in PG), `external_auth_id`, `status`, `created_at`. **No password column** — authentication is delegated (`07`).

**`merchant_users`** — `merchant_id`, `user_id`, `role`, `created_at`. Composite PK. Role ∈ `OWNER | ADMIN | STAFF | READ_ONLY`.

**`locations`** — `id`, `merchant_id`, `name`, `timezone` (IANA), address fields, `archived_at`

### Catalog

**`listings`** — `id`, `merchant_id`, `mode`, `name`, `slug`, `description`, `status`, `created_at`, `archived_at`

- `mode` ∈ `PRODUCT | SERVICE | RENTAL` — **immutable after creation.** Changing a listing's mode changes which capacity strategy governs it and invalidates existing reservations. Enforce with a CHECK on update or a guard in the repository.
- Unique `(merchant_id, slug)`.

**`listing_variants`** — `id`, `merchant_id`, `listing_id`, `sku`, `name`, `attributes_json`, `price_minor`, `currency`, `duration_minutes`, `rate_period`, `deposit_minor`, `archived_at`

- `duration_minutes` — services only.
- `rate_period` ∈ `HOUR | DAY | WEEK` — rentals only.
- `deposit_minor` — rentals only; nullable.
- Mode-specific columns are nullable with a CHECK constraint tying them to the parent listing's mode.

### Inventory — products and rentals

**`inventory_units`** — `id`, `merchant_id`, `variant_id`, `location_id`, `unit_code`, `tracking_mode`, `status`, `acquisition_cost_minor`, `acquired_at`, `expected_life_months`, `condition_grade`, `retired_at`

- `tracking_mode` ∈ `SERIALIZED | FUNGIBLE`
- `status` ∈ `AVAILABLE | SOLD | MAINTENANCE | RETIRED | LOST`
- **Rental assets are always `SERIALIZED`** — one row per physical kayak. This is required for the exclusion-constraint design in `05`, and it is what produces per-asset utilization data.
- `acquisition_cost_minor`, `acquired_at`, `expected_life_months` are captured for utilization analysis. Cheap now, impossible to backfill.

**`inventory_movements`** — `id`, `merchant_id`, `variant_id`, `unit_id`, `location_id`, `kind`, `quantity`, `order_line_id`, `occurred_at`, `actor_user_id`, `note`

- `kind` ∈ `RECEIPT | SALE | RENTAL_OUT | RENTAL_IN | ADJUSTMENT | TRANSFER | WRITE_OFF`
- **Append-only.** Current stock is the sum of movements, never a mutable counter. A `stock_snapshots` table may be added later for performance; the ledger stays authoritative.

### Service capacity

**`resources`** — `id`, `merchant_id`, `location_id`, `kind`, `name`, `capacity`, `archived_at`

- `kind` ∈ `STAFF | ROOM | EQUIPMENT`
- `capacity` — usually 1; >1 for a class or a room with seats.

**`listing_resources`** — `listing_id`, `resource_id`. Which resources can fulfil a service.

**`availability_rules`** — `id`, `merchant_id`, `resource_id`, `weekday`, `start_time`, `end_time`, `valid_from`, `valid_to`

- Recurring weekly availability. Deliberately **not** a full RRULE — weekday plus time window covers real merchant needs and is far easier to reason about and test.

**`availability_exceptions`** — `id`, `merchant_id`, `resource_id`, `starts_at`, `ends_at`, `kind`, `note`

- `kind` ∈ `BLACKOUT | EXTRA`. Holidays, sick days, one-off openings.

### The reservation — services and rentals

**`reservations`** — the correctness centre of the system.

| Column                      | Notes                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `id`                        | UUIDv7                                                             |
| `merchant_id`               | Tenant scope                                                       |
| `order_line_id`             | Nullable while `HELD` in a cart                                    |
| `subject_type`              | `RESOURCE \| INVENTORY_UNIT`                                       |
| `subject_id`                | FK by type                                                         |
| `starts_at`, `ends_at`      | Half-open `[start, end)`, UTC                                      |
| `quantity`                  | Against `resources.capacity`; always 1 for serialized units        |
| `state`                     | `HELD \| CONFIRMED \| IN_USE \| COMPLETED \| CANCELLED \| EXPIRED` |
| `expires_at`                | Set while `HELD`; cart-abandonment timeout                         |
| `created_at`, `released_at` |                                                                    |

**Blocking states are `HELD`, `CONFIRMED`, `IN_USE`.** `COMPLETED`, `CANCELLED`, and `EXPIRED` do not block. Every overlap query filters on this set, and the PostgreSQL exclusion constraint carries the same predicate (`05`).

### Orders

**`orders`** — `id`, `merchant_id`, `customer_user_id`, `status`, `currency`, `subtotal_minor`, `tax_minor`, `total_minor`, `placed_at`, `cancelled_at`

- `status` ∈ `CART | PENDING_PAYMENT | CONFIRMED | FULFILLED | CANCELLED | REFUNDED`

**`order_lines`** — `id`, `merchant_id`, `order_id`, `listing_id`, `variant_id`, `mode`, `quantity`, `unit_price_minor`, `line_total_minor`, `deposit_minor`, `starts_at`, `ends_at`

- `mode` copied from the listing at write time — an order line must remain interpretable after a listing is archived.
- Prices copied, never referenced. Historical orders must not change when a merchant edits a price.

### Payments and deposits

**`payments`** — `id`, `merchant_id`, `order_id`, `provider`, `provider_ref`, `kind`, `amount_minor`, `currency`, `status`, `created_at`, `raw_event_json`

- `kind` ∈ `CHARGE | REFUND | DEPOSIT_HOLD | DEPOSIT_CAPTURE`
- `provider_ref` unique per provider — the idempotency anchor for webhooks.

**`deposit_authorizations`** — `id`, `merchant_id`, `order_line_id`, `payment_id`, `amount_minor`, `currency`, `state`, `authorized_at`, `expires_at`, `captured_minor`, `released_at`

- `state` ∈ `AUTHORIZED | RELEASED | PARTIALLY_CAPTURED | CAPTURED | EXPIRED | FAILED`
- **`expires_at` is mandatory** and is set from the provider's authorization window. The 30-day ceiling is a hard product constraint (`05`).

### Rental lifecycle

**`fulfillment_events`** — `id`, `merchant_id`, `order_line_id`, `kind`, `occurred_at`, `actor_user_id`, `note`

- `kind` ∈ `PICKED_UP | RETURNED | NO_SHOW | COMPLETED | CANCELLED`
- Append-only. The reservation's state transitions are driven by these events, not set directly.

**`condition_reports`** — `id`, `merchant_id`, `order_line_id`, `inventory_unit_id`, `phase`, `condition_grade`, `notes`, `created_by`, `created_at`

- `phase` ∈ `CHECKOUT | CHECKIN`
- A checkout report is **required** before a rental line can move to `IN_USE`. Without it, a later damage claim has no baseline.

**`condition_media`** — `id`, `merchant_id`, `condition_report_id`, `storage_key`, `content_type`, `bytes`, `sha256`, `captured_at`

- `sha256` provides tamper evidence for what is, functionally, evidence in a financial dispute.

**`damage_claims`** — `id`, `merchant_id`, `order_line_id`, `amount_minor`, `state`, `filed_at`, `resolved_at`, `resolution_note`

- `state` ∈ `DRAFT | FILED | CUSTOMER_NOTIFIED | RESOLVED_CAPTURED | RESOLVED_WAIVED | DISPUTED`

### Platform administration (added 2026-09-08 — see `16_platform_admin_console.md`)

This is the one place in the schema where tenant scoping deliberately does not apply. `platform_users` has no `merchant_id`; access to a specific merchant happens only through a `support_access_grants` row, never through standing membership. **Excluded from the standard cross-tenant test generator by explicit, reviewed annotation** — a blanket skip would be more dangerous than a visible, documented one.

**`platform_users`** — `id`, `email` (unique), `role`, `mfa_enrolled_at`, `status`, `created_at`, `deactivated_at`. Role ∈ `PLATFORM_SUPPORT | PLATFORM_ADMIN | PLATFORM_SUPERADMIN`.

**`support_access_grants`** — `id`, `platform_user_id`, `merchant_id`, `reason`, `granted_at`, `expires_at`, `revoked_at`

- What turns break-glass into a scoped, time-boxed capability. No read or write against a merchant by a platform user is valid outside an active, unexpired grant.

**`platform_role_changes`** — `id`, `target_platform_user_id`, `old_role`, `new_role`, `changed_by`, `changed_at`, `reason`

- Append-only. Mirrors the `STAFF`→`OWNER` escalation-notification requirement in `07`, one level up: every change notifies all `PLATFORM_SUPERADMIN`s.

**`feature_flags`** — `id`, `key` (unique), `description`, `default_enabled`, `created_at`

**`feature_flag_overrides`** — `flag_id`, `merchant_id`, `enabled`, `set_by`, `set_at`. Composite PK on `(flag_id, merchant_id)`.

- Per-merchant override for staged rollouts. `packages/config` reads global default plus any override at request time.

### Audit

**`audit_log`** — `id`, `merchant_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `occurred_at`, `prev_hash`, `row_hash`

- Append-only, never updated or deleted.
- `row_hash = SHA256(prev_hash || canonical_json(row_without_hashes))` — a hash chain making silent modification detectable.
- **Mandatory** for: money movement, deposit state changes, inventory adjustments, role changes, and cross-merchant access attempts.

## Invariants the schema must enforce

These are the properties that are tested directly (`10`) and that gates G1–G4 verify.

| #   | Invariant                                                                                                           | Enforced by                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| I1  | No query returns rows from a merchant other than the caller's                                                       | Repository scoping + PG row-level security later                         |
| I2  | Two blocking reservations for the same subject never overlap                                                        | PG exclusion constraint; SQLite serialized transaction (`05`)            |
| I3  | An inventory unit with a blocking reservation cannot be sold                                                        | Service-layer check on the sale path                                     |
| I4  | A unit with `status = SOLD` or `RETIRED` cannot be reserved                                                         | Service-layer check on the reservation path                              |
| I5  | Stock never goes negative                                                                                           | Movement ledger check within the write transaction                       |
| I6  | A deposit is in exactly one state, and transitions follow the state machine                                         | Domain state machine; no direct state writes                             |
| I7  | A rental cannot reach `IN_USE` without a `CHECKOUT` condition report                                                | Service-layer guard                                                      |
| I8  | Order line totals equal quantity × unit price, in minor units                                                       | Domain invariant, asserted on write                                      |
| I9  | Every money-moving action produces an audit row                                                                     | Repository-layer interceptor                                             |
| I10 | No platform-user read or write against a merchant succeeds without an active, unexpired `support_access_grants` row | Service-layer guard on every `apps/admin` → merchant-data call; Gate G11 |

## Indexing

`reservations (merchant_id, subject_type, subject_id, starts_at, ends_at)` — the overlap query. `reservations (state, expires_at)` for the hold sweeper. `inventory_movements (merchant_id, variant_id, occurred_at)` for stock calculation. `order_lines (merchant_id, order_id)`. `payments (provider, provider_ref)` unique. Every FK indexed.

## Data captured for later analysis

Recorded from day one because it is nearly free now and cannot be reconstructed: `inventory_units.acquisition_cost_minor`, `acquired_at`, `expected_life_months`; every `RENTAL_OUT` / `RENTAL_IN` movement pair; `condition_grade` at both phases; and `reservations` intervals, from which utilisation is derived.

**Nothing consumes these in the MVP.** Store the inputs, not derived metrics — derived definitions change, raw events do not.
