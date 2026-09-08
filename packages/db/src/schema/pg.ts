import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Smoke-test table only — the PostgreSQL-dialect twin of
 * `schema/sqlite.ts`, per `docs/design/04`'s "matching pair per dialect"
 * migration rule. Not a domain table; do not add domain columns here.
 */
export const migrationSmokeTest = pgTable("migration_smoke_test", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/**
 * `docs/design/03` "Tenancy and identity". This is merchant_id's own row —
 * every other tenant-owned table's `merchant_id` foreign key points here.
 */
export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", {
      enum: ["ACTIVE", "SUSPENDED", "OFFBOARDED"],
    }).notNull(),
    defaultCurrency: text("default_currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("merchants_slug_unique").on(table.slug)],
);

/**
 * `docs/design/03`: "No password column — authentication is delegated
 * (`07`)." Identity lives here; credential verification is `AuthProvider`'s
 * job (`packages/domain/src/auth`), not this table's.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    externalAuthId: text("external_auth_id"),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

/** Merchant-scoped role assignment. Composite PK — one role per user per merchant. */
export const merchantUsers = pgTable(
  "merchant_users",
  {
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", {
      enum: ["OWNER", "ADMIN", "STAFF", "READ_ONLY"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.merchantId, table.userId] }),
  ],
);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
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
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * `docs/design/03` "Catalog". `mode` is the capacity-strategy discriminator
 * and is **immutable after creation** — enforced at the repository/service
 * layer (`D023`), not the DB, since a CHECK constraint only sees a single
 * row's proposed values and cannot compare against the row it replaces.
 */
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    mode: text("mode", { enum: ["PRODUCT", "SERVICE", "RENTAL"] }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
 * cross-table lookup. `duration_minutes` is services-only; `rate_period` and
 * `deposit_minor` are rentals-only.
 */
export const listingVariants = pgTable(
  "listing_variants",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    listingId: uuid("listing_id")
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "listing_variants_mode_fields_check",
      sql`(
        (${table.mode} = 'PRODUCT' AND ${table.durationMinutes} IS NULL AND ${table.ratePeriod} IS NULL AND ${table.depositMinor} IS NULL)
        OR (${table.mode} = 'SERVICE' AND ${table.ratePeriod} IS NULL AND ${table.depositMinor} IS NULL)
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
export const inventoryUnits = pgTable(
  "inventory_units",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => listingVariants.id),
    locationId: uuid("location_id")
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
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    expectedLifeMonths: integer("expected_life_months"),
    conditionGrade: text("condition_grade"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
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
export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => listingVariants.id),
  unitId: uuid("unit_id").references(() => inventoryUnits.id),
  locationId: uuid("location_id")
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
  orderLineId: uuid("order_line_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  actorUserId: uuid("actor_user_id")
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
export const resources = pgTable("resources", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  kind: text("kind", { enum: ["STAFF", "ROOM", "EQUIPMENT"] }).notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * `docs/design/03` "Service capacity". Recurring weekly availability for a
 * resource — deliberately weekday + time window, not a full RRULE.
 * `weekday` is 0 (Sunday) through 6 (Saturday). `validFrom`/`validTo` bound
 * the date range the rule applies over; `validTo` is nullable for a rule
 * with no planned end.
 */
export const availabilityRules = pgTable("availability_rules", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => resources.id),
  weekday: integer("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
});

/**
 * `docs/design/03` "Service capacity". One-off deviations from the
 * recurring `availability_rules` — a holiday closure (`BLACKOUT`) or an
 * extra opening (`EXTRA`), each bounded by a real half-open UTC interval
 * rather than a weekday/time-of-day pair.
 */
export const availabilityExceptions = pgTable("availability_exceptions", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => resources.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
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
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderLineId: uuid("order_line_id"),
    subjectType: text("subject_type", {
      enum: ["RESOURCE", "INVENTORY_UNIT"],
    }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    quantity: integer("quantity").notNull(),
    state: text("state", {
      enum: ["HELD", "CONFIRMED", "IN_USE", "COMPLETED", "CANCELLED", "EXPIRED"],
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    // D059 — caller-supplied Idempotency-Key, scoped per merchant. Nullable
    // because older reservation-creation paths (rentals, D050-D057) don't
    // pass one; the partial unique index below only constrains rows that do.
    idempotencyKey: text("idempotency_key"),
    // D062 — who/what asked for this hold, for the concurrent-hold caps
    // (`docs/design/07`/`14` T10). Both nullable: internal callers (rentals,
    // tests) have neither; an anonymous cart has an IP but no account.
    createdByAccountId: uuid("created_by_account_id"),
    createdByIp: text("created_by_ip"),
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
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  customerUserId: uuid("customer_user_id")
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
  placedAt: timestamp("placed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => listingVariants.id),
    mode: text("mode", { enum: ["PRODUCT", "SERVICE", "RENTAL"] }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    lineTotalMinor: integer("line_total_minor").notNull(),
    depositMinor: integer("deposit_minor"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
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
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderId: uuid("order_id")
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    rawEventJson: text("raw_event_json"),
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
export const depositAuthorizations = pgTable("deposit_authorizations", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  paymentId: uuid("payment_id")
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
  authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  capturedMinor: integer("captured_minor"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

/**
 * `docs/design/03` "Rental lifecycle". Append-only — an order line's
 * pickup/return/no-show/completion/cancellation history, not a mutable
 * status field. The reservation's own state transitions are driven by
 * these events, not set directly.
 */
export const fulfillmentEvents = pgTable("fulfillment_events", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  kind: text("kind", {
    enum: ["PICKED_UP", "RETURNED", "NO_SHOW", "COMPLETED", "CANCELLED"],
  }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  actorUserId: uuid("actor_user_id")
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
export const conditionReports = pgTable("condition_reports", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  inventoryUnitId: uuid("inventory_unit_id")
    .notNull()
    .references(() => inventoryUnits.id),
  phase: text("phase", { enum: ["CHECKOUT", "CHECKIN"] }).notNull(),
  conditionGrade: text("condition_grade").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/**
 * `docs/design/03` "Rental lifecycle". `sha256` is the tamper-evidence
 * anchor the security check names — a checkout/checkin photo is
 * functionally evidence in a financial dispute, so its content hash is
 * recorded alongside the storage pointer rather than trusted implicitly.
 */
export const conditionMedia = pgTable("condition_media", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  conditionReportId: uuid("condition_report_id")
    .notNull()
    .references(() => conditionReports.id),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
});

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
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
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
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  prevHash: text("prev_hash").notNull(),
  rowHash: text("row_hash").notNull(),
});

export const damageClaims = pgTable("damage_claims", {
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderLineId: uuid("order_line_id")
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
  filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
});
