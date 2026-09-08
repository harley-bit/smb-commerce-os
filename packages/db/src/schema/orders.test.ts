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

const listing = {
  id: "listing-1",
  merchantId: "merchant-1",
  mode: "PRODUCT" as const,
  name: "Widget",
  slug: "widget",
  status: "PUBLISHED" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

const variant = {
  id: "variant-1",
  merchantId: "merchant-1",
  listingId: "listing-1",
  mode: "PRODUCT" as const,
  sku: "WIDGET-1",
  name: "Widget - default",
  priceMinor: 2500,
  currency: "USD",
};

const order = {
  id: "order-1",
  merchantId: "merchant-1",
  customerUserId: "user-1",
  status: "CONFIRMED" as const,
  currency: "USD",
  subtotalMinor: 2500,
  taxMinor: 0,
  totalMinor: 2500,
  placedAt: "2026-09-08T00:00:00.000Z",
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.users).values(user);
  await connection.db.insert(sqliteSchema.listings).values(listing);
  await connection.db.insert(sqliteSchema.listingVariants).values(variant);
}

describe("orders / order_lines tables (SQLite)", () => {
  it("applies the orders and order_lines migrations", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('orders', 'order_lines') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual(["order_lines", "orders"]);
  });

  it("has the order_lines (merchant_id, order_id) index", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const indexColumns = connection.sqlite
      .prepare("PRAGMA index_info('order_lines_merchant_order_idx')")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexColumns).toEqual(["merchant_id", "order_id"]);
  });

  it("round-trips an order with an order_line", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.orders).values(order);
    await connection.db.insert(sqliteSchema.orderLines).values({
      id: "order-line-1",
      merchantId: "merchant-1",
      orderId: "order-1",
      listingId: "listing-1",
      variantId: "variant-1",
      mode: "PRODUCT",
      quantity: 1,
      unitPriceMinor: 2500,
      lineTotalMinor: 2500,
    });

    const orderRows = await connection.db.select().from(sqliteSchema.orders);
    const lineRows = await connection.db
      .select()
      .from(sqliteSchema.orderLines);

    expect(orderRows).toEqual([expect.objectContaining({ id: "order-1" })]);
    expect(lineRows).toEqual([
      expect.objectContaining({
        id: "order-line-1",
        mode: "PRODUCT",
        unitPriceMinor: 2500,
        lineTotalMinor: 2500,
      }),
    ]);
  });

  it("archiving a listing does not alter a historical order line's copied price and mode", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.orders).values(order);
    await connection.db.insert(sqliteSchema.orderLines).values({
      id: "order-line-1",
      merchantId: "merchant-1",
      orderId: "order-1",
      listingId: "listing-1",
      variantId: "variant-1",
      mode: "PRODUCT",
      quantity: 1,
      unitPriceMinor: 2500,
      lineTotalMinor: 2500,
    });

    // The listing's price changes and the listing is archived after the
    // order was placed — neither should touch the already-written order line.
    await connection.db
      .update(sqliteSchema.listingVariants)
      .set({ priceMinor: 9999 });
    await connection.db
      .update(sqliteSchema.listings)
      .set({ archivedAt: "2026-09-09T00:00:00.000Z", status: "ARCHIVED" });

    const lineRows = await connection.db
      .select()
      .from(sqliteSchema.orderLines);

    expect(lineRows).toEqual([
      expect.objectContaining({
        id: "order-line-1",
        mode: "PRODUCT",
        unitPriceMinor: 2500,
        lineTotalMinor: 2500,
      }),
    ]);
  });

  it("rejects an order referencing a non-existent merchant — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.orders).values({
        ...order,
        merchantId: "does-not-exist",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "orders / order_lines tables (real PostgreSQL)",
  () => {
    it("applies the migration, round-trips an order line, and enforces the merchant/order index", async () => {
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

        await connection.db.insert(pgSchema.users).values({
          id: "018e6b3a-9c3e-7000-8000-000000000002",
          email: "customer@example.com",
          status: "ACTIVE",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listings).values({
          id: "018e6b3a-9c3e-7000-8000-000000000003",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          mode: "PRODUCT",
          name: "Widget",
          slug: "widget",
          status: "PUBLISHED",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listingVariants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000004",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          listingId: "018e6b3a-9c3e-7000-8000-000000000003",
          mode: "PRODUCT",
          sku: "WIDGET-1",
          name: "Widget - default",
          priceMinor: 2500,
          currency: "USD",
        });

        await connection.db.insert(pgSchema.orders).values({
          id: "018e6b3a-9c3e-7000-8000-000000000005",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          customerUserId: "018e6b3a-9c3e-7000-8000-000000000002",
          status: "CONFIRMED",
          currency: "USD",
          subtotalMinor: 2500,
          taxMinor: 0,
          totalMinor: 2500,
          placedAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.orderLines).values({
          id: "018e6b3a-9c3e-7000-8000-000000000006",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          orderId: "018e6b3a-9c3e-7000-8000-000000000005",
          listingId: "018e6b3a-9c3e-7000-8000-000000000003",
          variantId: "018e6b3a-9c3e-7000-8000-000000000004",
          mode: "PRODUCT",
          quantity: 1,
          unitPriceMinor: 2500,
          lineTotalMinor: 2500,
        });

        const rows = await connection.db.select().from(pgSchema.orderLines);
        expect(rows).toHaveLength(1);

        const indexRows = await connection.pool.query(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'order_lines'",
        );
        const indexNames = indexRows.rows.map(
          (row: { indexname: string }) => row.indexname,
        );
        expect(indexNames).toContain("order_lines_merchant_order_idx");

        await expect(
          connection.db.insert(pgSchema.orders).values({
            id: "018e6b3a-9c3e-7000-8000-000000000007",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000099",
            customerUserId: "018e6b3a-9c3e-7000-8000-000000000002",
            status: "CONFIRMED",
            currency: "USD",
            subtotalMinor: 2500,
            taxMinor: 0,
            totalMinor: 2500,
            placedAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
