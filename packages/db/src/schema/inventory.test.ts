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

const location = {
  id: "location-1",
  merchantId: "merchant-1",
  name: "Main warehouse",
  timezone: "UTC",
};

const listing = {
  id: "listing-1",
  merchantId: "merchant-1",
  mode: "PRODUCT" as const,
  name: "Kayak paddle",
  slug: "kayak-paddle",
  status: "PUBLISHED" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

const variant = {
  id: "variant-1",
  merchantId: "merchant-1",
  listingId: "listing-1",
  mode: "PRODUCT" as const,
  sku: "PADDLE-STD",
  name: "Standard",
  priceMinor: 4500,
  currency: "USD",
};

const user = {
  id: "user-1",
  email: "actor@example.com",
  status: "ACTIVE" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

async function seed(connection: ReturnType<typeof createConnection>) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.users).values(user);
  await connection.db.insert(sqliteSchema.locations).values(location);
  await connection.db.insert(sqliteSchema.listings).values(listing);
  await connection.db.insert(sqliteSchema.listingVariants).values(variant);
}

describe("inventory tables (SQLite)", () => {
  it("applies the inventory_units/inventory_movements migration", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const tableNames = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inventory_units', 'inventory_movements')",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(new Set(tableNames)).toEqual(
      new Set(["inventory_units", "inventory_movements"]),
    );
  });

  it("has no stock/quantity counter column on inventory_units — stock is derived, never stored", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    const columns = connection.sqlite
      .prepare("PRAGMA table_info(inventory_units)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).not.toContain("stock");
    expect(columns).not.toContain("quantity");
    expect(columns).not.toContain("stock_quantity");
  });

  it("round-trips a SERIALIZED inventory unit", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.inventoryUnits).values({
      id: "unit-1",
      merchantId: "merchant-1",
      variantId: "variant-1",
      locationId: "location-1",
      unitCode: "PADDLE-STD-0001",
      trackingMode: "SERIALIZED",
      status: "AVAILABLE",
    });

    const units = await connection.db
      .select()
      .from(sqliteSchema.inventoryUnits);
    expect(units).toEqual([
      expect.objectContaining({
        id: "unit-1",
        trackingMode: "SERIALIZED",
        status: "AVAILABLE",
      }),
    ]);
  });

  it("computes current stock as the sum of signed movement quantities, not a stored counter", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const movements = [
      { kind: "RECEIPT", quantity: 10 },
      { kind: "SALE", quantity: -3 },
      { kind: "SALE", quantity: -2 },
      { kind: "ADJUSTMENT", quantity: -1 },
    ] as const;

    for (const [i, movement] of movements.entries()) {
      await connection.db.insert(sqliteSchema.inventoryMovements).values({
        id: `movement-${i}`,
        merchantId: "merchant-1",
        variantId: "variant-1",
        locationId: "location-1",
        kind: movement.kind,
        quantity: movement.quantity,
        occurredAt: "2026-09-08T00:00:00.000Z",
        actorUserId: "user-1",
        note: "test movement",
      });
    }

    const rows = await connection.db
      .select()
      .from(sqliteSchema.inventoryMovements);
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);

    expect(total).toBe(4); // 10 - 3 - 2 - 1
  });

  it("appending a correcting movement changes the sum; nothing is ever updated in place", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.inventoryMovements).values({
      id: "movement-1",
      merchantId: "merchant-1",
      variantId: "variant-1",
      locationId: "location-1",
      kind: "RECEIPT",
      quantity: 5,
      occurredAt: "2026-09-08T00:00:00.000Z",
      actorUserId: "user-1",
      note: "initial receipt",
    });

    let rows = await connection.db
      .select()
      .from(sqliteSchema.inventoryMovements);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);

    // Correct an over-count by appending a new movement, not mutating the first row.
    await connection.db.insert(sqliteSchema.inventoryMovements).values({
      id: "movement-2",
      merchantId: "merchant-1",
      variantId: "variant-1",
      locationId: "location-1",
      kind: "ADJUSTMENT",
      quantity: -2,
      occurredAt: "2026-09-08T00:01:00.000Z",
      actorUserId: "user-1",
      note: "correcting over-count from movement-1",
    });

    rows = await connection.db.select().from(sqliteSchema.inventoryMovements);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(3);
  });

  it("rejects a movement with no actor — actor is mandatory", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.inventoryMovements).values({
        id: "movement-1",
        merchantId: "merchant-1",
        variantId: "variant-1",
        locationId: "location-1",
        kind: "RECEIPT",
        quantity: 5,
        occurredAt: "2026-09-08T00:00:00.000Z",
        // actorUserId omitted
        note: "no actor",
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a movement with no note — reason is mandatory", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.inventoryMovements).values({
        id: "movement-1",
        merchantId: "merchant-1",
        variantId: "variant-1",
        locationId: "location-1",
        kind: "RECEIPT",
        quantity: 5,
        occurredAt: "2026-09-08T00:00:00.000Z",
        actorUserId: "user-1",
        // note omitted
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a movement referencing a non-existent variant — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.inventoryMovements).values({
        id: "movement-1",
        merchantId: "merchant-1",
        variantId: "does-not-exist",
        locationId: "location-1",
        kind: "RECEIPT",
        quantity: 5,
        occurredAt: "2026-09-08T00:00:00.000Z",
        actorUserId: "user-1",
        note: "bad fk",
      }),
    ).rejects.toThrow();
  });

  it("rejects an inventory unit referencing a non-existent location — FK enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await expect(
      connection.db.insert(sqliteSchema.inventoryUnits).values({
        id: "unit-1",
        merchantId: "merchant-1",
        variantId: "variant-1",
        locationId: "does-not-exist",
        unitCode: "PADDLE-STD-0001",
        trackingMode: "SERIALIZED",
        status: "AVAILABLE",
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (merchant_id, unit_code) inventory unit — unique constraint enforced", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    await connection.db.insert(sqliteSchema.inventoryUnits).values({
      id: "unit-1",
      merchantId: "merchant-1",
      variantId: "variant-1",
      locationId: "location-1",
      unitCode: "PADDLE-STD-0001",
      trackingMode: "SERIALIZED",
      status: "AVAILABLE",
    });

    await expect(
      connection.db.insert(sqliteSchema.inventoryUnits).values({
        id: "unit-2",
        merchantId: "merchant-1",
        variantId: "variant-1",
        locationId: "location-1",
        unitCode: "PADDLE-STD-0001",
        trackingMode: "SERIALIZED",
        status: "AVAILABLE",
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "inventory tables (real PostgreSQL)",
  () => {
    it("applies the migration, round-trips a unit and movements, sums correctly, and enforces mandatory actor/note", async () => {
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
          id: "018e6b3a-9c3e-7000-8000-000000000003",
          email: "actor@example.com",
          status: "ACTIVE",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.locations).values({
          id: "018e6b3a-9c3e-7000-8000-000000000002",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          name: "Main warehouse",
          timezone: "UTC",
        });

        await connection.db.insert(pgSchema.listings).values({
          id: "018e6b3a-9c3e-7000-8000-000000000010",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          mode: "PRODUCT",
          name: "Kayak paddle",
          slug: "kayak-paddle",
          status: "PUBLISHED",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        });

        await connection.db.insert(pgSchema.listingVariants).values({
          id: "018e6b3a-9c3e-7000-8000-000000000011",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          listingId: "018e6b3a-9c3e-7000-8000-000000000010",
          mode: "PRODUCT",
          sku: "PADDLE-STD",
          name: "Standard",
          priceMinor: 4500,
          currency: "USD",
        });

        await connection.db.insert(pgSchema.inventoryUnits).values({
          id: "018e6b3a-9c3e-7000-8000-000000000020",
          merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
          variantId: "018e6b3a-9c3e-7000-8000-000000000011",
          locationId: "018e6b3a-9c3e-7000-8000-000000000002",
          unitCode: "PADDLE-STD-0001",
          trackingMode: "SERIALIZED",
          status: "AVAILABLE",
        });

        await connection.db.insert(pgSchema.inventoryMovements).values([
          {
            id: "018e6b3a-9c3e-7000-8000-000000000030",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            variantId: "018e6b3a-9c3e-7000-8000-000000000011",
            locationId: "018e6b3a-9c3e-7000-8000-000000000002",
            kind: "RECEIPT",
            quantity: 10,
            occurredAt: new Date("2026-09-08T00:00:00.000Z"),
            actorUserId: "018e6b3a-9c3e-7000-8000-000000000003",
            note: "initial receipt",
          },
          {
            id: "018e6b3a-9c3e-7000-8000-000000000031",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            variantId: "018e6b3a-9c3e-7000-8000-000000000011",
            locationId: "018e6b3a-9c3e-7000-8000-000000000002",
            kind: "SALE",
            quantity: -4,
            occurredAt: new Date("2026-09-08T00:01:00.000Z"),
            actorUserId: "018e6b3a-9c3e-7000-8000-000000000003",
            note: "sold 4 units",
          },
        ]);

        const rows = await connection.db
          .select()
          .from(pgSchema.inventoryMovements);
        expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(6);

        await expect(
          connection.db.insert(pgSchema.inventoryMovements).values({
            id: "018e6b3a-9c3e-7000-8000-000000000032",
            merchantId: "018e6b3a-9c3e-7000-8000-000000000001",
            variantId: "018e6b3a-9c3e-7000-8000-000000000011",
            locationId: "018e6b3a-9c3e-7000-8000-000000000002",
            kind: "ADJUSTMENT",
            quantity: -1,
            occurredAt: new Date("2026-09-08T00:02:00.000Z"),
            note: "missing actor",
          } as never),
        ).rejects.toThrow();
      } finally {
        await connection.pool.end();
      }
    });
  },
);
