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

async function seedMerchant(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
}

describe("catalog tables (SQLite)", () => {
  it("applies the listings/listing_variants migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('listings', 'listing_variants')",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(new Set(tableNames)).toEqual(
      new Set(["listings", "listing_variants"]),
    );
  });

  it("round-trips a PRODUCT listing and a plain variant", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "PRODUCT",
      name: "Kayak paddle",
      slug: "kayak-paddle",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.listingVariants).values({
      id: "variant-1",
      merchantId: "merchant-1",
      listingId: "listing-1",
      mode: "PRODUCT",
      sku: "PADDLE-STD",
      name: "Standard",
      priceMinor: 4500,
      currency: "USD",
    });

    const listings = await connection.db
      .select()
      .from(sqliteSchema.listings);
    const variants = await connection.db
      .select()
      .from(sqliteSchema.listingVariants);

    expect(listings).toHaveLength(1);
    expect(variants).toEqual([
      expect.objectContaining({
        id: "variant-1",
        mode: "PRODUCT",
        sku: "PADDLE-STD",
        priceMinor: 4500,
      }),
    ]);
  });

  it("rejects a duplicate (merchant_id, slug) listing — unique constraint enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "PRODUCT",
      name: "Kayak paddle",
      slug: "kayak-paddle",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listings).values({
        id: "listing-2",
        merchantId: "merchant-1",
        mode: "SERVICE",
        name: "Kayak paddle again",
        slug: "kayak-paddle",
        status: "PUBLISHED",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("rejects a variant referencing a non-existent listing — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "does-not-exist",
        mode: "PRODUCT",
        sku: "PADDLE-STD",
        name: "Standard",
        priceMinor: 4500,
        currency: "USD",
      }),
    ).rejects.toThrow();
  });

  it("rejects a PRODUCT variant carrying a SERVICE-only field (duration_minutes) — mode CHECK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "PRODUCT",
      name: "Kayak paddle",
      slug: "kayak-paddle",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "listing-1",
        mode: "PRODUCT",
        sku: "PADDLE-STD",
        name: "Standard",
        priceMinor: 4500,
        currency: "USD",
        durationMinutes: 30,
      }),
    ).rejects.toThrow();
  });

  it("rejects a SERVICE variant carrying a RENTAL-only field (rate_period) — mode CHECK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "SERVICE",
      name: "Guided tour",
      slug: "guided-tour",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "listing-1",
        mode: "SERVICE",
        sku: "TOUR-90",
        name: "90 minutes",
        priceMinor: 9000,
        currency: "USD",
        durationMinutes: 90,
        ratePeriod: "HOUR",
      }),
    ).rejects.toThrow();
  });

  it("rejects a RENTAL variant carrying a SERVICE-only field (duration_minutes) — mode CHECK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "listing-1",
        mode: "RENTAL",
        sku: "KAYAK-1",
        name: "Single kayak",
        priceMinor: 5000,
        currency: "USD",
        ratePeriod: "DAY",
        depositMinor: 10000,
        durationMinutes: 60,
      }),
    ).rejects.toThrow();
  });

  it("accepts a RENTAL variant with rate_period and deposit_minor set, nothing else", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.listingVariants).values({
      id: "variant-1",
      merchantId: "merchant-1",
      listingId: "listing-1",
      mode: "RENTAL",
      sku: "KAYAK-1",
      name: "Single kayak",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 10000,
    });

    const variants = await connection.db
      .select()
      .from(sqliteSchema.listingVariants);
    expect(variants).toHaveLength(1);
  });

  it("rejects a PRODUCT variant carrying a RENTAL-only field (buffer_minutes) — mode CHECK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "PRODUCT",
      name: "Kayak paddle",
      slug: "kayak-paddle",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "listing-1",
        mode: "PRODUCT",
        sku: "PADDLE-STD",
        name: "Standard",
        priceMinor: 4500,
        currency: "USD",
        bufferMinutes: 15,
      }),
    ).rejects.toThrow();
  });

  it("rejects a SERVICE variant carrying a RENTAL-only field (buffer_minutes) — mode CHECK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "SERVICE",
      name: "Guided tour",
      slug: "guided-tour",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.listingVariants).values({
        id: "variant-1",
        merchantId: "merchant-1",
        listingId: "listing-1",
        mode: "SERVICE",
        sku: "TOUR-90",
        name: "90 minutes",
        priceMinor: 9000,
        currency: "USD",
        durationMinutes: 90,
        bufferMinutes: 15,
      }),
    ).rejects.toThrow();
  });

  it("accepts a RENTAL variant with rate_period, deposit_minor, and buffer_minutes set", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seedMerchant(connection);

    await connection.db.insert(sqliteSchema.listings).values({
      id: "listing-1",
      merchantId: "merchant-1",
      mode: "RENTAL",
      name: "Kayak",
      slug: "kayak",
      status: "PUBLISHED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.listingVariants).values({
      id: "variant-1",
      merchantId: "merchant-1",
      listingId: "listing-1",
      mode: "RENTAL",
      sku: "KAYAK-1",
      name: "Single kayak",
      priceMinor: 5000,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 10000,
      bufferMinutes: 30,
    });

    const variants = await connection.db
      .select()
      .from(sqliteSchema.listingVariants);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ bufferMinutes: 30 });
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "catalog tables (real PostgreSQL)",
  () => {
    it("applies the migration, round-trips a listing/variant, and enforces the mode CHECK", async () => {
      const connectionString = process.env.DATABASE_URL as string;
      const connection = createPgConnection(connectionString);

      try {
        await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
        await connection.pool.query('CREATE SCHEMA "public"');
        await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');

        await runPgMigrations(connection);

        await connection.db.insert(pgSchema.merchants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Acme Rentals",
          slug: "acme-rentals",
          status: "ACTIVE",
          defaultCurrency: "USD",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listings).values({
          id: "018e6b3a-9c3e-7000-8000-000000000010",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          mode: "SERVICE",
          name: "Guided tour",
          slug: "guided-tour",
          status: "PUBLISHED",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listingVariants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000011",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          listingId: "018e6b3a-9c3e-7000-8000-000000000010",
          mode: "SERVICE",
          sku: "TOUR-90",
          name: "90 minutes",
          priceMinor: 9000,
          currency: "USD",
          durationMinutes: 90,
        });

        const variants = await connection.db
          .select()
          .from(pgSchema.listingVariants);
        expect(variants).toHaveLength(1);

        await expect(
          connection.db.insert(pgSchema.listingVariants).values({
            id: "018e6b3a-9c3e-7000-8000-000000000012",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            listingId: "018e6b3a-9c3e-7000-8000-000000000010",
            mode: "SERVICE",
            sku: "TOUR-90-BAD",
            name: "Invalid",
            priceMinor: 9000,
            currency: "USD",
            ratePeriod: "HOUR",
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
