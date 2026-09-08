import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
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
