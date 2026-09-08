import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { createPgConnection } from "../pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "../migrate.js";
import * as sqliteSchema from "./sqlite.js";
import * as pgSchema from "./pg.js";

const merchant = {
  id: "merchant-1",
  name: "Acme Rentals",
  slug: "acme-rentals",
  status: "ACTIVE" as const,
  defaultCurrency: "USD",
  createdAt: "2026-09-08T00:00:00.000Z",
};

const user = {
  id: "user-1",
  email: "customer@example.com",
  status: "ACTIVE" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

const location = {
  id: "location-1",
  merchantId: "merchant-1",
  name: "Main Store",
  timezone: "America/New_York",
};

const listing = {
  id: "listing-1",
  merchantId: "merchant-1",
  mode: "RENTAL" as const,
  name: "Cargo Trailer",
  slug: "cargo-trailer",
  status: "PUBLISHED" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

const variant = {
  id: "variant-1",
  merchantId: "merchant-1",
  listingId: "listing-1",
  mode: "RENTAL" as const,
  sku: "TRAILER-1",
  name: "Cargo Trailer - default",
  priceMinor: 5000,
  currency: "USD",
  ratePeriod: "DAY" as const,
  depositMinor: 20000,
};

const order = {
  id: "order-1",
  merchantId: "merchant-1",
  customerUserId: "user-1",
  status: "CONFIRMED" as const,
  currency: "USD",
  subtotalMinor: 5000,
  taxMinor: 0,
  totalMinor: 5000,
  placedAt: "2026-09-08T00:00:00.000Z",
};

const orderLine = {
  id: "order-line-1",
  merchantId: "merchant-1",
  orderId: "order-1",
  listingId: "listing-1",
  variantId: "variant-1",
  mode: "RENTAL" as const,
  quantity: 1,
  unitPriceMinor: 5000,
  lineTotalMinor: 5000,
};

const inventoryUnit = {
  id: "unit-1",
  merchantId: "merchant-1",
  variantId: "variant-1",
  locationId: "location-1",
  unitCode: "SN-1",
  trackingMode: "SERIALIZED" as const,
  status: "AVAILABLE" as const,
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.users).values(user);
  await connection.db.insert(sqliteSchema.locations).values(location);
  await connection.db.insert(sqliteSchema.listings).values(listing);
  await connection.db.insert(sqliteSchema.listingVariants).values(variant);
  await connection.db.insert(sqliteSchema.orders).values(order);
  await connection.db.insert(sqliteSchema.orderLines).values(orderLine);
  await connection.db.insert(sqliteSchema.inventoryUnits).values(inventoryUnit);
}

describe("rental lifecycle tables (SQLite)", () => {
  it("applies the fulfillment_events, condition_reports, condition_media, damage_claims migrations", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('fulfillment_events', 'condition_reports', 'condition_media', 'damage_claims') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual([
      "condition_media",
      "condition_reports",
      "damage_claims",
      "fulfillment_events",
    ]);
  });

  it("round-trips a fulfillment event", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.fulfillmentEvents).values({
      id: "event-1",
      merchantId: "merchant-1",
      orderLineId: "order-line-1",
      kind: "PICKED_UP",
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: "user-1",
      note: "Customer picked up trailer at store.",
    });

    const rows = await connection.db
      .select()
      .from(sqliteSchema.fulfillmentEvents);

    expect(rows).toEqual([
      expect.objectContaining({ id: "event-1", kind: "PICKED_UP" }),
    ]);
  });

  it("round-trips a condition report and its media, with sha256 present", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.conditionReports).values({
      id: "report-1",
      merchantId: "merchant-1",
      orderLineId: "order-line-1",
      inventoryUnitId: "unit-1",
      phase: "CHECKOUT",
      conditionGrade: "GOOD",
      notes: "No visible damage.",
      createdBy: "user-1",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.conditionMedia).values({
      id: "media-1",
      merchantId: "merchant-1",
      conditionReportId: "report-1",
      storageKey: "condition-media/report-1/photo-1.jpg",
      contentType: "image/jpeg",
      bytes: 204800,
      sha256: "a".repeat(64),
      capturedAt: "2026-09-08T00:00:00.000Z",
    });

    const reportRows = await connection.db
      .select()
      .from(sqliteSchema.conditionReports);
    const mediaRows = await connection.db
      .select()
      .from(sqliteSchema.conditionMedia);

    expect(reportRows).toEqual([
      expect.objectContaining({ id: "report-1", phase: "CHECKOUT" }),
    ]);
    expect(mediaRows).toEqual([
      expect.objectContaining({ id: "media-1", sha256: "a".repeat(64) }),
    ]);
  });

  it("round-trips a damage claim", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.damageClaims).values({
      id: "claim-1",
      merchantId: "merchant-1",
      orderLineId: "order-line-1",
      amountMinor: 15000,
      state: "FILED",
      filedAt: "2026-09-08T00:00:00.000Z",
    });

    const rows = await connection.db.select().from(sqliteSchema.damageClaims);

    expect(rows).toEqual([
      expect.objectContaining({ id: "claim-1", state: "FILED" }),
    ]);
  });

  it("rejects a fulfillment event referencing a non-existent order line — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.fulfillmentEvents).values({
        id: "event-1",
        merchantId: "merchant-1",
        orderLineId: "does-not-exist",
        kind: "PICKED_UP",
        occurredAt: "2026-09-08T00:00:00.000Z",
        actorUserId: "user-1",
        note: "n/a",
      }),
    ).rejects.toThrow();
  });

  it("rejects condition media referencing a non-existent condition report — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.conditionMedia).values({
        id: "media-1",
        merchantId: "merchant-1",
        conditionReportId: "does-not-exist",
        storageKey: "x",
        contentType: "image/jpeg",
        bytes: 1,
        sha256: "a".repeat(64),
        capturedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("rejects a damage claim referencing a non-existent order line — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.damageClaims).values({
        id: "claim-1",
        merchantId: "merchant-1",
        orderLineId: "does-not-exist",
        amountMinor: 15000,
        state: "FILED",
        filedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "rental lifecycle tables (real PostgreSQL)",
  () => {
    it("applies the migration and enforces FKs", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query(
          'DROP TABLE IF EXISTS "damage_claims", "condition_media", "condition_reports", "fulfillment_events", "deposit_authorizations", "payments", "order_lines", "orders", "reservations", "availability_exceptions", "availability_rules", "resources", "inventory_movements", "inventory_units", "listing_variants", "listings", "locations", "merchant_users", "users", "merchants", "migration_smoke_test" CASCADE',
        );
        await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

        await runPgMigrations(connection);

        const ids = {
          merchant: "018e6b3a-9c3e-7000-8000-000000000001",
          user: "018e6b3a-9c3e-7000-8000-000000000002",
          location: "018e6b3a-9c3e-7000-8000-000000000003",
          listing: "018e6b3a-9c3e-7000-8000-000000000004",
          variant: "018e6b3a-9c3e-7000-8000-000000000005",
          order: "018e6b3a-9c3e-7000-8000-000000000006",
          orderLine: "018e6b3a-9c3e-7000-8000-000000000007",
          unit: "018e6b3a-9c3e-7000-8000-000000000008",
          event: "018e6b3a-9c3e-7000-8000-000000000009",
          report: "018e6b3a-9c3e-7000-8000-00000000000a",
          media: "018e6b3a-9c3e-7000-8000-00000000000b",
          claim: "018e6b3a-9c3e-7000-8000-00000000000c",
        };

        await connection.db.insert(pgSchema.merchants).values({
          id: ids.merchant,
          name: "Acme Rentals",
          slug: "acme-rentals",
          status: "ACTIVE",
          defaultCurrency: "USD",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.users).values({
          id: ids.user,
          email: "customer@example.com",
          status: "ACTIVE",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.locations).values({
          id: ids.location,
          merchantId: ids.merchant,
          name: "Main Store",
          timezone: "America/New_York",
        });

        await connection.db.insert(pgSchema.listings).values({
          id: ids.listing,
          merchantId: ids.merchant,
          mode: "RENTAL",
          name: "Cargo Trailer",
          slug: "cargo-trailer",
          status: "PUBLISHED",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listingVariants).values({
          id: ids.variant,
          merchantId: ids.merchant,
          listingId: ids.listing,
          mode: "RENTAL",
          sku: "TRAILER-1",
          name: "Cargo Trailer - default",
          priceMinor: 5000,
          currency: "USD",
          ratePeriod: "DAY",
          depositMinor: 20000,
        });

        await connection.db.insert(pgSchema.orders).values({
          id: ids.order,
          merchantId: ids.merchant,
          customerUserId: ids.user,
          status: "CONFIRMED",
          currency: "USD",
          subtotalMinor: 5000,
          taxMinor: 0,
          totalMinor: 5000,
          placedAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.orderLines).values({
          id: ids.orderLine,
          merchantId: ids.merchant,
          orderId: ids.order,
          listingId: ids.listing,
          variantId: ids.variant,
          mode: "RENTAL",
          quantity: 1,
          unitPriceMinor: 5000,
          lineTotalMinor: 5000,
        });

        await connection.db.insert(pgSchema.inventoryUnits).values({
          id: ids.unit,
          merchantId: ids.merchant,
          variantId: ids.variant,
          locationId: ids.location,
          unitCode: "SN-1",
          trackingMode: "SERIALIZED",
          status: "AVAILABLE",
        });

        await connection.db.insert(pgSchema.fulfillmentEvents).values({
          id: ids.event,
          merchantId: ids.merchant,
          orderLineId: ids.orderLine,
          kind: "PICKED_UP",
          occurredAt: new Date("2026-09-08T00:00:00.000Z"),
          actorUserId: ids.user,
          note: "Customer picked up trailer at store.",
        });

        await connection.db.insert(pgSchema.conditionReports).values({
          id: ids.report,
          merchantId: ids.merchant,
          orderLineId: ids.orderLine,
          inventoryUnitId: ids.unit,
          phase: "CHECKOUT",
          conditionGrade: "GOOD",
          notes: "No visible damage.",
          createdBy: ids.user,
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.conditionMedia).values({
          id: ids.media,
          merchantId: ids.merchant,
          conditionReportId: ids.report,
          storageKey: "condition-media/report-1/photo-1.jpg",
          contentType: "image/jpeg",
          bytes: 204800,
          sha256: "a".repeat(64),
          capturedAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.damageClaims).values({
          id: ids.claim,
          merchantId: ids.merchant,
          orderLineId: ids.orderLine,
          amountMinor: 15000,
          state: "FILED",
          filedAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        const eventRows = await connection.db
          .select()
          .from(pgSchema.fulfillmentEvents);
        const reportRows = await connection.db
          .select()
          .from(pgSchema.conditionReports);
        const mediaRows = await connection.db
          .select()
          .from(pgSchema.conditionMedia);
        const claimRows = await connection.db
          .select()
          .from(pgSchema.damageClaims);

        expect(eventRows).toHaveLength(1);
        expect(reportRows).toHaveLength(1);
        expect(mediaRows).toHaveLength(1);
        expect(claimRows).toHaveLength(1);

        await expect(
          connection.db.insert(pgSchema.conditionMedia).values({
            id: "018e6b3a-9c3e-7000-8000-00000000000d",
            merchantId: ids.merchant,
            conditionReportId: "018e6b3a-9c3e-7000-8000-000000000fff",
            storageKey: "x",
            contentType: "image/jpeg",
            bytes: 1,
            sha256: "b".repeat(64),
            capturedAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
