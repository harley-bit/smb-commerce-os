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

const orderLine = {
  id: "order-line-1",
  merchantId: "merchant-1",
  orderId: "order-1",
  listingId: "listing-1",
  variantId: "variant-1",
  mode: "PRODUCT" as const,
  quantity: 1,
  unitPriceMinor: 2500,
  lineTotalMinor: 2500,
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.users).values(user);
  await connection.db.insert(sqliteSchema.listings).values(listing);
  await connection.db.insert(sqliteSchema.listingVariants).values(variant);
  await connection.db.insert(sqliteSchema.orders).values(order);
  await connection.db.insert(sqliteSchema.orderLines).values(orderLine);
}

describe("payments / deposit_authorizations tables (SQLite)", () => {
  it("applies the payments and deposit_authorizations migrations", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('payments', 'deposit_authorizations') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual(["deposit_authorizations", "payments"]);
  });

  it("round-trips a payment and a deposit authorization", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.payments).values({
      id: "payment-1",
      merchantId: "merchant-1",
      orderId: "order-1",
      provider: "STRIPE",
      providerRef: "pi_123",
      kind: "DEPOSIT_HOLD",
      amountMinor: 5000,
      currency: "USD",
      status: "PENDING",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.depositAuthorizations).values({
      id: "deposit-1",
      merchantId: "merchant-1",
      orderLineId: "order-line-1",
      paymentId: "payment-1",
      amountMinor: 5000,
      currency: "USD",
      state: "AUTHORIZED",
      authorizedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });

    const paymentRows = await connection.db
      .select()
      .from(sqliteSchema.payments);
    const depositRows = await connection.db
      .select()
      .from(sqliteSchema.depositAuthorizations);

    expect(paymentRows).toEqual([
      expect.objectContaining({ id: "payment-1", providerRef: "pi_123" }),
    ]);
    expect(depositRows).toEqual([
      expect.objectContaining({ id: "deposit-1", state: "AUTHORIZED" }),
    ]);
  });

  it("enforces a unique (provider, provider_ref) constraint — the webhook idempotency anchor", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.payments).values({
      id: "payment-1",
      merchantId: "merchant-1",
      orderId: "order-1",
      provider: "STRIPE",
      providerRef: "pi_123",
      kind: "CHARGE",
      amountMinor: 2500,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.payments).values({
        id: "payment-2",
        merchantId: "merchant-1",
        orderId: "order-1",
        provider: "STRIPE",
        providerRef: "pi_123",
        kind: "CHARGE",
        amountMinor: 2500,
        currency: "USD",
        status: "SUCCEEDED",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("allows the same provider_ref across two different providers", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.payments).values({
      id: "payment-1",
      merchantId: "merchant-1",
      orderId: "order-1",
      provider: "STRIPE",
      providerRef: "ref-shared",
      kind: "CHARGE",
      amountMinor: 2500,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      connection.db.insert(sqliteSchema.payments).values({
        id: "payment-2",
        merchantId: "merchant-1",
        orderId: "order-1",
        provider: "OTHER_PROVIDER",
        providerRef: "ref-shared",
        kind: "CHARGE",
        amountMinor: 2500,
        currency: "USD",
        status: "SUCCEEDED",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).resolves.not.toThrow();
  });

  it("rejects a payment referencing a non-existent order — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.payments).values({
        id: "payment-1",
        merchantId: "merchant-1",
        orderId: "does-not-exist",
        provider: "STRIPE",
        providerRef: "pi_123",
        kind: "CHARGE",
        amountMinor: 2500,
        currency: "USD",
        status: "SUCCEEDED",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "payments / deposit_authorizations tables (real PostgreSQL)",
  () => {
    it("applies the migration, enforces the provider/provider_ref unique constraint", async () => {
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

        await connection.db.insert(pgSchema.payments).values({
          id: "018e6b3a-9c3e-7000-8000-000000000007",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          orderId: "018e6b3a-9c3e-7000-8000-000000000005",
          provider: "STRIPE",
          providerRef: "pi_123",
          kind: "DEPOSIT_HOLD",
          amountMinor: 5000,
          currency: "USD",
          status: "PENDING",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.depositAuthorizations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000008",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          orderLineId: "018e6b3a-9c3e-7000-8000-000000000006",
          paymentId: "018e6b3a-9c3e-7000-8000-000000000007",
          amountMinor: 5000,
          currency: "USD",
          state: "AUTHORIZED",
          authorizedAt: new Date("2026-09-08T00:00:00.000Z"),
          expiresAt: new Date("2026-10-08T00:00:00.000Z"),
        });

        const rows = await connection.db.select().from(pgSchema.payments);
        expect(rows).toHaveLength(1);

        const indexRows = await connection.pool.query(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'payments'",
        );
        const indexNames = indexRows.rows.map(
          (row: { indexname: string }) => row.indexname,
        );
        expect(indexNames).toContain("payments_provider_provider_ref_unique");

        await expect(
          connection.db.insert(pgSchema.payments).values({
            id: "018e6b3a-9c3e-7000-8000-000000000009",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            orderId: "018e6b3a-9c3e-7000-8000-000000000005",
            provider: "STRIPE",
            providerRef: "pi_123",
            kind: "CHARGE",
            amountMinor: 2500,
            currency: "USD",
            status: "SUCCEEDED",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
