import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Smoke-test table only — exercises the migration tooling (drizzle-kit
 * generate + apply, both dialects) before Phase 1's real tenancy schema
 * lands in D018. Not a domain table; do not add domain columns here.
 */
export const migrationSmokeTest = sqliteTable("migration_smoke_test", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

/**
 * `docs/design/03` "Tenancy and identity". This is merchant_id's own row —
 * every other tenant-owned table's `merchant_id` foreign key points here.
 */
export const merchants = sqliteTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", {
      enum: ["ACTIVE", "SUSPENDED", "OFFBOARDED"],
    }).notNull(),
    defaultCurrency: text("default_currency").notNull(),
    createdAt: text("created_at").notNull(),
    archivedAt: text("archived_at"),
    // Seller identity, captured at onboarding (D103) — DAC7/DSA readiness
    // per `docs/design/08` line 11. Nullable: pre-onboarding fixture rows
    // created before this card (and cards that only need a merchant row to
    // exist for an FK, not a real onboarding) never set them.
    legalName: text("legal_name"),
    taxId: text("tax_id"),
    businessAddressLine1: text("business_address_line1"),
    businessAddressLine2: text("business_address_line2"),
    businessCity: text("business_city"),
    businessState: text("business_state"),
    businessPostalCode: text("business_postal_code"),
    businessCountry: text("business_country"),
  },
  (table) => [uniqueIndex("merchants_slug_unique").on(table.slug)],
);

/**
 * `docs/design/03`: "No password column — authentication is delegated
 * (`07`)." Identity lives here; credential verification is `AuthProvider`'s
 * job (`packages/domain/src/auth`), not this table's.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    externalAuthId: text("external_auth_id"),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

/** Merchant-scoped role assignment. Composite PK — one role per user per merchant. */
export const merchantUsers = sqliteTable(
  "merchant_users",
  {
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", {
      enum: ["OWNER", "ADMIN", "STAFF", "READ_ONLY"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.merchantId, table.userId] }),
  ],
);

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  archivedAt: text("archived_at"),
});

/**
 * `docs/design/03` "Catalog". `mode` is the capacity-strategy discriminator
 * and is **immutable after creation** — enforced at the repository/service
 * layer (`D023`), not the DB, since a CHECK constraint only sees a single
 * row's proposed values and cannot compare against the row it replaces.
 */
export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    mode: text("mode", { enum: ["PRODUCT", "SERVICE", "RENTAL"] }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("listings_merchant_slug_unique").on(
      table.merchantId,
      table.slug,
    ),
  ],
);

/**
 * `docs/design/03` "Catalog". `mode` is denormalized from the parent
 * `listings` row (copied at write time, same rationale as `order_lines.mode`)
 * so the mode-specific-field CHECK below can be enforced locally without a
 * cross-table lookup. `duration_minutes` is services-only; `rate_period`,
 * `deposit_minor`, and `buffer_minutes` are rentals-only. `buffer_minutes`
 * is the turnaround gap (cleaning/inspection/charging) applied by expanding
 * a reservation's effective interval at write time (`docs/design/05`), not
 * by complicating the overlap predicate itself.
 */
export const listingVariants = sqliteTable(
  "listing_variants",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    mode: text("mode", { enum: ["PRODUCT", "SERVICE", "RENTAL"] }).notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    attributesJson: text("attributes_json"),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    durationMinutes: integer("duration_minutes"),
    ratePeriod: text("rate_period", { enum: ["HOUR", "DAY", "WEEK"] }),
    depositMinor: integer("deposit_minor"),
    bufferMinutes: integer("buffer_minutes"),
    archivedAt: text("archived_at"),
  },
  (table) => [
    check(
      "listing_variants_mode_fields_check",
      sql`(
        (${table.mode} = 'PRODUCT' AND ${table.durationMinutes} IS NULL AND ${table.ratePeriod} IS NULL AND ${table.depositMinor} IS NULL AND ${table.bufferMinutes} IS NULL)
        OR (${table.mode} = 'SERVICE' AND ${table.ratePeriod} IS NULL AND ${table.depositMinor} IS NULL AND ${table.bufferMinutes} IS NULL)
        OR (${table.mode} = 'RENTAL' AND ${table.durationMinutes} IS NULL)
      )`,
    ),
  ],
);

/**
 * `docs/design/03` "Inventory — products and rentals". One row per tracked
 * unit. Rental assets are always `SERIALIZED` (one row per physical item);
 * `FUNGIBLE` units represent an untracked-per-item stock pool for a
 * variant/location pair. Deliberately has no stock/quantity column — current
 * stock is always derived from summing `inventory_movements`, never stored.
 */
export const inventoryUnits = sqliteTable(
  "inventory_units",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => listingVariants.id),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    unitCode: text("unit_code").notNull(),
    trackingMode: text("tracking_mode", {
      enum: ["SERIALIZED", "FUNGIBLE"],
    }).notNull(),
    status: text("status", {
      enum: ["AVAILABLE", "SOLD", "MAINTENANCE", "RETIRED", "LOST"],
    }).notNull(),
    acquisitionCostMinor: integer("acquisition_cost_minor"),
    acquiredAt: text("acquired_at"),
    expectedLifeMonths: integer("expected_life_months"),
    conditionGrade: text("condition_grade"),
    retiredAt: text("retired_at"),
  },
  (table) => [
    uniqueIndex("inventory_units_merchant_unit_code_unique").on(
      table.merchantId,
      table.unitCode,
    ),
  ],
);

/**
 * `docs/design/03` "Inventory — products and rentals". **Append-only** —
 * current stock is `SUM(quantity)` grouped by variant (and, for serialized
 * units, by unit), never a mutable counter. `quantity` is signed: inbound
 * kinds (`RECEIPT`, `RENTAL_IN`) are positive, outbound kinds (`SALE`,
 * `RENTAL_OUT`, `WRITE_OFF`) are negative, `ADJUSTMENT`/`TRANSFER` carry
 * whatever sign corrects the count. `unit_id` is nullable — `FUNGIBLE` stock
 * moves at the variant/location level with no single unit to reference.
 * `order_line_id` is a plain reference (not a FK) — `order_lines` doesn't
 * exist yet; it lands in a later phase. `actor_user_id` and `note` are
 * mandatory: every movement is auditable to a person and a reason.
 */
export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  variantId: text("variant_id")
    .notNull()
    .references(() => listingVariants.id),
  unitId: text("unit_id").references(() => inventoryUnits.id),
  locationId: text("location_id")
    .notNull()
    .references(() => locations.id),
  kind: text("kind", {
    enum: [
      "RECEIPT",
      "SALE",
      "RENTAL_OUT",
      "RENTAL_IN",
      "ADJUSTMENT",
      "TRANSFER",
      "WRITE_OFF",
    ],
  }).notNull(),
  quantity: integer("quantity").notNull(),
  orderLineId: text("order_line_id"),
  occurredAt: text("occurred_at").notNull(),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => users.id),
  note: text("note").notNull(),
});

/**
 * `docs/design/03` "Service capacity". A bookable subject for `SERVICE`
 * listings — a staff member, a room, or a piece of equipment. `capacity` is
 * usually 1 (one instructor, one room) but can exceed 1 for a class or a
 * room with seats; it is the bound a future reservation service must check
 * concurrent `HELD`/`CONFIRMED`/`IN_USE` reservations against (`D026`+ —
 * this card is schema only, no capacity-checking logic yet).
 */
export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  locationId: text("location_id")
    .notNull()
    .references(() => locations.id),
  kind: text("kind", { enum: ["STAFF", "ROOM", "EQUIPMENT"] }).notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  archivedAt: text("archived_at"),
});

/**
 * `docs/design/03` "Service capacity". Recurring weekly availability for a
 * resource — deliberately weekday + time window, not a full RRULE.
 * `weekday` is 0 (Sunday) through 6 (Saturday). `validFrom`/`validTo` bound
 * the date range the rule applies over; `validTo` is nullable for a rule
 * with no planned end.
 */
export const availabilityRules = sqliteTable("availability_rules", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resources.id),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
});

/**
 * `docs/design/03` "Service capacity". One-off deviations from the
 * recurring `availability_rules` — a holiday closure (`BLACKOUT`) or an
 * extra opening (`EXTRA`), each bounded by a real half-open UTC interval
 * rather than a weekday/time-of-day pair.
 */
export const availabilityExceptions = sqliteTable("availability_exceptions", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resources.id),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  kind: text("kind", { enum: ["BLACKOUT", "EXTRA"] }).notNull(),
  note: text("note"),
});

/**
 * `docs/design/03` "The reservation — services and rentals" — "the
 * correctness centre of the system." `subjectType`/`subjectId` is a
 * polymorphic reference (`RESOURCE` → `resources.id`, `INVENTORY_UNIT` →
 * `inventory_units.id`); no single FK is possible across both, so it is
 * enforced at the service layer, not the DB. **Blocking states are `HELD`,
 * `CONFIRMED`, `IN_USE`** (`05`) — every overlap query and the hold sweeper
 * filter on this set. This card is schema only: the two indexes below make
 * the overlap query and the sweeper's blocking-state scan efficient, but
 * the actual overlap-prevention guarantee (PG exclusion constraint / SQLite
 * `BEGIN IMMEDIATE` serialization, invariant I2) is a later card's job —
 * see `docs/design/05` C1 and gate G3.
 */
export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderLineId: text("order_line_id"),
    subjectType: text("subject_type", {
      enum: ["RESOURCE", "INVENTORY_UNIT"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    quantity: integer("quantity").notNull(),
    state: text("state", {
      enum: ["HELD", "CONFIRMED", "IN_USE", "COMPLETED", "CANCELLED", "EXPIRED"],
    }).notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
    // D059 — caller-supplied Idempotency-Key, scoped per merchant. Nullable
    // because older reservation-creation paths (rentals, D050-D057) don't
    // pass one; the partial unique index below only constrains rows that do.
    idempotencyKey: text("idempotency_key"),
    // D062 — who/what asked for this hold, for the concurrent-hold caps
    // (`docs/design/07`/`14` T10). Both nullable: internal callers (rentals,
    // tests) have neither; an anonymous cart has an IP but no account.
    createdByAccountId: text("created_by_account_id"),
    createdByIp: text("created_by_ip"),
    // D064 — the rental-variant turnaround buffer this reservation's
    // `ends_at` was expanded by at write time (`docs/design/05` "Turnaround
    // buffer"). Snapshotted here, not re-derived from the variant, so a
    // later change to the variant's `buffer_minutes` cannot retroactively
    // alter an already-written booking's effective interval.
    bufferMinutes: integer("buffer_minutes"),
  },
  (table) => [
    index("reservations_subject_interval_idx").on(
      table.merchantId,
      table.subjectType,
      table.subjectId,
      table.startsAt,
      table.endsAt,
    ),
    index("reservations_state_expires_idx").on(table.state, table.expiresAt),
    uniqueIndex("reservations_merchant_idempotency_key_unique")
      .on(table.merchantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    // D062 — the two lookups `countActiveHoldsByAccount`/`countActiveHoldsByIp`
    // run on every booking attempt, so both need their own index rather than
    // sharing `reservations_state_expires_idx`.
    index("reservations_holder_account_idx").on(table.merchantId, table.state, table.createdByAccountId),
    index("reservations_holder_ip_idx").on(table.merchantId, table.state, table.createdByIp),
  ],
);

/**
 * `docs/design/03` "Orders". `status` drives the cart → fulfilled/cancelled
 * lifecycle; totals are always recomputed server-side (`CLAUDE.md`), never
 * trusted from a client payload — this table stores the result, not the
 * source of truth for the computation.
 */
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  customerUserId: text("customer_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", {
    enum: [
      "CART",
      "PENDING_PAYMENT",
      "CONFIRMED",
      "FULFILLED",
      "CANCELLED",
      "REFUNDED",
    ],
  }).notNull(),
  currency: text("currency").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  placedAt: text("placed_at"),
  cancelledAt: text("cancelled_at"),
});

/**
 * `docs/design/03` "Orders". `mode`, `unit_price_minor`, and `line_total_minor`
 * are **copied from the listing/variant at write time, never referenced** —
 * this is the card's own acceptance criterion: archiving or repricing a
 * listing later must not alter a historical order line. `listing_id` and
 * `variant_id` remain as plain lineage references (still FKs — the row they
 * point to just isn't the source of truth for price/mode after checkout).
 * `starts_at`/`ends_at` are nullable — only populated for `SERVICE`/`RENTAL`
 * lines.
 */
export const orderLines = sqliteTable(
  "order_lines",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => listingVariants.id),
    mode: text("mode", { enum: ["PRODUCT", "SERVICE", "RENTAL"] }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    lineTotalMinor: integer("line_total_minor").notNull(),
    depositMinor: integer("deposit_minor"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
  },
  (table) => [
    index("order_lines_merchant_order_idx").on(
      table.merchantId,
      table.orderId,
    ),
  ],
);

/**
 * `docs/design/03` "Payments and deposits". `provider_ref` is unique per
 * `provider` — the idempotency anchor `06`'s webhook handler looks up before
 * reprocessing an event, so the same provider can never record the same
 * event twice. **No PAN, CVV, or track data anywhere in this table** — card
 * data never touches our servers (`07`); `provider_ref` and `raw_event_json`
 * carry only what the provider's API already treats as non-card metadata.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    kind: text("kind", {
      enum: ["CHARGE", "REFUND", "DEPOSIT_HOLD", "DEPOSIT_CAPTURE"],
    }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status", {
      enum: ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    rawEventJson: text("raw_event_json"),
    // `docs/cards/D093.md` — the provider event's own timestamp (Stripe's
    // `created`) for whichever event last updated `status`. Lets a webhook
    // handler ignore an out-of-order/stale delivery instead of regressing
    // `status` backward — see `PaymentRepository.applyProviderEvent` and
    // `@smb-os/domain`'s `applyOrderedEvent`.
    lastEventAt: text("last_event_at"),
  },
  (table) => [
    uniqueIndex("payments_provider_provider_ref_unique").on(
      table.provider,
      table.providerRef,
    ),
  ],
);

/**
 * `docs/design/03` "Payments and deposits". `expires_at` is **mandatory** —
 * set from the provider's authorization window, with a 30-day ceiling as a
 * hard product constraint (`05`). Financial record: never deleted, no
 * `archivedAt` column.
 */
export const depositAuthorizations = sqliteTable("deposit_authorizations", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  paymentId: text("payment_id")
    .notNull()
    .references(() => payments.id),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  state: text("state", {
    enum: [
      "AUTHORIZED",
      "RELEASED",
      "PARTIALLY_CAPTURED",
      "CAPTURED",
      "EXPIRED",
      "FAILED",
    ],
  }).notNull(),
  authorizedAt: text("authorized_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  capturedMinor: integer("captured_minor"),
  releasedAt: text("released_at"),
});

/**
 * `docs/design/03` "Rental lifecycle". Append-only — an order line's
 * pickup/return/no-show/completion/cancellation history, not a mutable
 * status field. The reservation's own state transitions are driven by
 * these events, not set directly.
 */
export const fulfillmentEvents = sqliteTable("fulfillment_events", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  kind: text("kind", {
    enum: ["PICKED_UP", "RETURNED", "NO_SHOW", "COMPLETED", "CANCELLED"],
  }).notNull(),
  occurredAt: text("occurred_at").notNull(),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => users.id),
  note: text("note").notNull(),
});

/**
 * `docs/design/03` "Rental lifecycle". `phase` distinguishes a `CHECKOUT`
 * report (required before a rental line can move to `IN_USE`) from a
 * `CHECKIN` report — without the former, a later damage claim has no
 * baseline to compare against.
 */
export const conditionReports = sqliteTable("condition_reports", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  inventoryUnitId: text("inventory_unit_id")
    .notNull()
    .references(() => inventoryUnits.id),
  phase: text("phase", { enum: ["CHECKOUT", "CHECKIN"] }).notNull(),
  conditionGrade: text("condition_grade").notNull(),
  notes: text("notes"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
});

/**
 * `docs/design/03` "Rental lifecycle". `sha256` is the tamper-evidence
 * anchor the security check names — a checkout/checkin photo is
 * functionally evidence in a financial dispute, so its content hash is
 * recorded alongside the storage pointer rather than trusted implicitly.
 */
export const conditionMedia = sqliteTable(
  "condition_media",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    conditionReportId: text("condition_report_id")
      .notNull()
      .references(() => conditionReports.id),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [uniqueIndex("condition_media_storage_key_unique").on(table.storageKey)],
);

/**
 * `docs/design/03` "Rental lifecycle". Financial record: never deleted, no
 * `archivedAt` column. `resolved_at`/`resolution_note` are nullable —
 * populated once `state` reaches one of the `RESOLVED_*`/`DISPUTED` states.
 */
/**
 * `docs/design/03` "Audit". Append-only — no code path in this package
 * updates or deletes a row here; `AuditLogRepository` exposes only
 * `append`/`list`. `prev_hash`/`row_hash` are the hash chain: each row's
 * `row_hash = SHA256(prev_hash || canonical_json(row_without_hashes))`
 * (`../audit/hashChain.ts`), so a silently edited row no longer matches
 * its own `row_hash`, and a fixed-up `row_hash` no longer matches the
 * next row's `prev_hash` — tampering is *detectable*, not merely harder,
 * per `docs/design/07`'s security rationale.
 */
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  /**
   * Per-merchant monotonic append order. UUIDv7's timestamp prefix is only
   * millisecond-resolution, so two rows appended for the same merchant in
   * the same millisecond can sort out of insertion order by `id` alone —
   * `seq` (assigned by `AuditLogRepository.append` as `previous.seq + 1`)
   * is what `list`/the verifier actually order and chain by.
   */
  seq: integer("seq").notNull(),
  actorType: text("actor_type", { enum: ["USER", "SYSTEM", "PLATFORM"] }).notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  occurredAt: text("occurred_at").notNull(),
  prevHash: text("prev_hash").notNull(),
  rowHash: text("row_hash").notNull(),
});

export const damageClaims = sqliteTable("damage_claims", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  amountMinor: integer("amount_minor").notNull(),
  state: text("state", {
    enum: [
      "DRAFT",
      "FILED",
      "CUSTOMER_NOTIFIED",
      "RESOLVED_CAPTURED",
      "RESOLVED_WAIVED",
      "DISPUTED",
    ],
  }).notNull(),
  filedAt: text("filed_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolutionNote: text("resolution_note"),
});

/**
 * `docs/design/06` "Webhook handling" step 2 / `docs/cards/D092.md` — the
 * idempotency anchor for *inbound* webhook deliveries themselves, keyed on
 * the provider's own event id (Stripe's `evt_...`), which is distinct from
 * `payments.provider_ref` (a payment/intent id, the anchor for the payment
 * record once a handler processes an event). No merchant_id: a raw event
 * hasn't been matched to an order/merchant yet at the point it's persisted
 * here — that matching is later handler logic (D093+), not this table's
 * job — so this is a plain global table like `users`, not tenant-scoped.
 */
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_id_unique").on(table.provider, table.eventId),
  ],
);
