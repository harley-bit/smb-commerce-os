import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { createPgConnection, type PgConnection } from "../pg-connection.js";
import { runSqliteMigrations, runPgMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import * as pgSchema from "../schema/pg.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { sweepExpiredHoldsSqlite, sweepExpiredHoldsPg } from "./HoldExpirySweeper.js";

const merchantId = generateUuidV7();

const merchant = {
  id: merchantId,
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
  merchantId,
  name: "Main studio",
  timezone: "UTC",
};

const resource = {
  id: "resource-1",
  merchantId,
  locationId: "location-1",
  kind: "STAFF" as const,
  name: "Jane the instructor",
  capacity: 1,
};

const listing = {
  id: "listing-1",
  merchantId,
  mode: "SERVICE" as const,
  name: "Session",
  slug: "session",
  status: "PUBLISHED" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
};

const variant = {
  id: "variant-1",
  merchantId,
  listingId: "listing-1",
  mode: "SERVICE" as const,
  sku: "SESSION-1",
  name: "Session - default",
  priceMinor: 5000,
  currency: "USD",
  durationMinutes: 60,
};

const order = {
  id: "order-1",
  merchantId,
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
  merchantId,
  orderId: "order-1",
  listingId: "listing-1",
  variantId: "variant-1",
  mode: "SERVICE" as const,
  quantity: 1,
  unitPriceMinor: 5000,
  lineTotalMinor: 5000,
};

async function seed(connection: Connection) {
  await connection.db.insert(sqliteSchema.merchants).values(merchant);
  await connection.db.insert(sqliteSchema.users).values(user);
  await connection.db.insert(sqliteSchema.locations).values(location);
  await connection.db.insert(sqliteSchema.resources).values(resource);
  await connection.db.insert(sqliteSchema.listings).values(listing);
  await connection.db.insert(sqliteSchema.listingVariants).values(variant);
  await connection.db.insert(sqliteSchema.orders).values(order);
  await connection.db.insert(sqliteSchema.orderLines).values(orderLine);
  await connection.db.insert(sqliteSchema.payments).values({
    id: "payment-1",
    merchantId,
    orderId: "order-1",
    provider: "STRIPE",
    providerRef: "pi_123",
    kind: "DEPOSIT_HOLD",
    amountMinor: 5000,
    currency: "USD",
    status: "SUCCEEDED",
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  await connection.db.insert(sqliteSchema.depositAuthorizations).values({
    id: "deposit-1",
    merchantId,
    orderLineId: "order-line-1",
    paymentId: "payment-1",
    amountMinor: 5000,
    currency: "USD",
    state: "AUTHORIZED",
    authorizedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
  });
}

describe("sweepExpiredHoldsSqlite (D057)", () => {
  it("transitions an expired HELD reservation to EXPIRED and releases its deposit authorization", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    const reservationId = repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T08:15:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const result = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z");

    expect(result.expiredReservationIds).toEqual([reservationId]);
    expect(result.releasedDepositAuthorizationIds).toEqual(["deposit-1"]);

    const reservationRows = connection.sqlite
      .prepare("SELECT state, released_at FROM reservations WHERE id = ?")
      .get(reservationId) as { state: string; released_at: string | null };
    expect(reservationRows.state).toBe("EXPIRED");
    expect(reservationRows.released_at).toBe("2026-10-01T08:20:00.000Z");

    const depositRow = connection.sqlite
      .prepare("SELECT state, released_at FROM deposit_authorizations WHERE id = 'deposit-1'")
      .get() as { state: string; released_at: string | null };
    expect(depositRow.state).toBe("RELEASED");
    expect(depositRow.released_at).toBe("2026-10-01T08:20:00.000Z");
  });

  it("does not touch a HELD reservation that has not expired yet", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    const reservationId = repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T09:00:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const result = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z");

    expect(result.expiredReservationIds).toEqual([]);
    expect(result.releasedDepositAuthorizationIds).toEqual([]);

    const row = connection.sqlite
      .prepare("SELECT state FROM reservations WHERE id = ?")
      .get(reservationId) as { state: string };
    expect(row.state).toBe("HELD");
  });

  it("does not release a deposit authorization that is not in AUTHORIZED state", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);
    connection.sqlite
      .prepare("UPDATE deposit_authorizations SET state = 'CAPTURED' WHERE id = 'deposit-1'")
      .run();

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T08:15:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const result = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z");

    expect(result.expiredReservationIds).toHaveLength(1);
    expect(result.releasedDepositAuthorizationIds).toEqual([]);

    const depositRow = connection.sqlite
      .prepare("SELECT state FROM deposit_authorizations WHERE id = 'deposit-1'")
      .get() as { state: string };
    expect(depositRow.state).toBe("CAPTURED");
  });

  it("is idempotent: running it again after a successful sweep is a no-op", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T08:15:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const first = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z");
    expect(first.expiredReservationIds).toHaveLength(1);
    expect(first.releasedDepositAuthorizationIds).toHaveLength(1);

    const second = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z");
    expect(second.expiredReservationIds).toEqual([]);
    expect(second.releasedDepositAuthorizationIds).toEqual([]);

    const third = sweepExpiredHoldsSqlite(connection, "2026-10-01T09:30:00.000Z");
    expect(third.expiredReservationIds).toEqual([]);
    expect(third.releasedDepositAuthorizationIds).toEqual([]);
  });

  it("docs/cards/D062.md — reports abandonment via the onAbandoned hook exactly when holds actually expired", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    const reservationId = repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "HELD",
      expiresAt: "2026-10-01T08:15:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const reports: unknown[] = [];
    const result = sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z", (r) => reports.push(r));

    expect(reports).toEqual([result]);
    expect(result.expiredReservationIds).toEqual([reservationId]);

    // Nothing left to sweep — the hook must not fire for an empty result
    // (this card's security check: abandonment monitoring should not
    // generate alert noise on every no-op tick of a job that runs every
    // minute).
    const secondReports: unknown[] = [];
    sweepExpiredHoldsSqlite(connection, "2026-10-01T08:20:00.000Z", (r) => secondReports.push(r));
    expect(secondReports).toEqual([]);
  });

  it("never expires CONFIRMED/IN_USE reservations, only HELD ones", async () => {
    const connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    await seed(connection);

    const ctx = createTenantContext(merchantId);
    const repo = new ReservationRepository(connection);
    const confirmedId = repo.create(ctx, {
      orderLineId: "order-line-1",
      subjectType: "RESOURCE",
      subjectId: "resource-1",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: "2026-10-01T08:00:00.000Z",
    });

    const result = sweepExpiredHoldsSqlite(connection, "2026-12-01T00:00:00.000Z");
    expect(result.expiredReservationIds).toEqual([]);

    const row = connection.sqlite
      .prepare("SELECT state FROM reservations WHERE id = ?")
      .get(confirmedId) as { state: string };
    expect(row.state).toBe("CONFIRMED");
  });
});

describe("sweepExpiredHoldsSqlite — concurrency (D057, real worker-thread race)", () => {
  const workerUrl = fileURLToPath(new URL("./holdSweeperWorker.mjs", import.meta.url));

  interface WorkerResult {
    expiredReservationIds: string[];
    releasedDepositAuthorizationIds: string[];
  }

  function runWorker(workerData: Record<string, unknown>): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, { workerData });
      worker.once("message", (msg: WorkerResult) => resolve(msg));
      worker.once("error", reject);
    });
  }

  it(
    "N sweepers racing the same expired hold agree on exactly one winner — no double-expiry, no double-release",
    async () => {
      execFileSync("pnpm", ["--filter", "@smb-os/domain", "--filter", "@smb-os/db", "build"], {
        cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
        stdio: "inherit",
      });
      expect(existsSync(fileURLToPath(new URL("../../dist/connection.js", import.meta.url)))).toBe(true);

      const tmpDir = mkdtempSync(join(tmpdir(), "d057-sweeper-race-"));
      const dbPath = join(tmpDir, "test.sqlite");

      const seedConnection: Connection = createConnection(dbPath);
      await runSqliteMigrations(seedConnection);
      await seed(seedConnection);

      const ctx = createTenantContext(merchantId);
      const repo = new ReservationRepository(seedConnection);
      const reservationId = repo.create(ctx, {
        orderLineId: "order-line-1",
        subjectType: "RESOURCE",
        subjectId: "resource-1",
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        quantity: 1,
        state: "HELD",
        expiresAt: "2026-10-01T08:15:00.000Z",
        createdAt: "2026-10-01T08:00:00.000Z",
      });
      seedConnection.sqlite.close();

      const ATTEMPTS = 10;
      const readyFlag = new SharedArrayBuffer(4);
      const goFlag = new SharedArrayBuffer(4);
      const ready = new Int32Array(readyFlag);
      const go = new Int32Array(goFlag);

      const resultPromises = Array.from({ length: ATTEMPTS }, () =>
        runWorker({ dbPath, asOf: "2026-10-01T08:20:00.000Z", readyFlag, goFlag }),
      );

      const deadline = Date.now() + 45_000;
      while (Atomics.load(ready, 0) < ATTEMPTS) {
        if (Date.now() > deadline) {
          throw new Error(`Only ${Atomics.load(ready, 0)}/${ATTEMPTS} workers became ready`);
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      Atomics.store(go, 0, 1);
      Atomics.notify(go, 0, ATTEMPTS);

      const results = await Promise.all(resultPromises);

      const totalExpired = results.flatMap((r) => r.expiredReservationIds);
      const totalReleased = results.flatMap((r) => r.releasedDepositAuthorizationIds);

      // Exactly one of the N concurrent sweeper runs should have actually
      // performed the transition — every other run's `UPDATE ... WHERE
      // state = 'HELD'` matches zero rows because it already committed.
      expect(totalExpired).toEqual([reservationId]);
      expect(totalReleased).toEqual(["deposit-1"]);

      const verifyConnection = createConnection(dbPath);
      const reservationRow = verifyConnection.sqlite
        .prepare("SELECT state FROM reservations WHERE id = ?")
        .get(reservationId) as { state: string };
      expect(reservationRow.state).toBe("EXPIRED");
      const depositRow = verifyConnection.sqlite
        .prepare("SELECT state FROM deposit_authorizations WHERE id = 'deposit-1'")
        .get() as { state: string };
      expect(depositRow.state).toBe("RELEASED");
      verifyConnection.sqlite.close();

      rmSync(tmpDir, { recursive: true, force: true });
    },
    90_000,
  );
});

describe.skipIf(!process.env.DATABASE_URL)("sweepExpiredHoldsPg (D057, real PostgreSQL)", () => {
  const merchantId = "018e6b3a-9c3e-7000-8000-0000000000e1";
  const userId = "018e6b3a-9c3e-7000-8000-0000000000e2";
  const locationId = "018e6b3a-9c3e-7000-8000-0000000000e3";
  const resourceId = "018e6b3a-9c3e-7000-8000-0000000000e4";
  const listingId = "018e6b3a-9c3e-7000-8000-0000000000e5";
  const variantId = "018e6b3a-9c3e-7000-8000-0000000000e6";
  const orderId = "018e6b3a-9c3e-7000-8000-0000000000e7";
  const orderLineId = "018e6b3a-9c3e-7000-8000-0000000000e8";
  const paymentId = "018e6b3a-9c3e-7000-8000-0000000000e9";
  const depositId = "018e6b3a-9c3e-7000-8000-0000000000ea";

  async function freshConnection(): Promise<PgConnection> {
    const connectionString = process.env.DATABASE_URL as string;
    const connection = createPgConnection(connectionString);

    await connection.pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await connection.pool.query('CREATE SCHEMA "public"');
    await connection.pool.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
    await runPgMigrations(connection);

    await connection.db.insert(pgSchema.merchants).values({
      id: merchantId,
      name: "Acme Rentals",
      slug: "acme-rentals",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    await connection.db.insert(pgSchema.users).values({
      id: userId,
      email: "customer@example.com",
      status: "ACTIVE",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    await connection.db.insert(pgSchema.locations).values({
      id: locationId,
      merchantId,
      name: "Main studio",
      timezone: "UTC",
    });
    await connection.db.insert(pgSchema.resources).values({
      id: resourceId,
      merchantId,
      locationId,
      kind: "STAFF",
      name: "Jane the instructor",
      capacity: 1,
    });
    await connection.db.insert(pgSchema.listings).values({
      id: listingId,
      merchantId,
      mode: "SERVICE",
      name: "Session",
      slug: "session",
      status: "PUBLISHED",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    await connection.db.insert(pgSchema.listingVariants).values({
      id: variantId,
      merchantId,
      listingId,
      mode: "SERVICE",
      sku: "SESSION-1",
      name: "Session - default",
      priceMinor: 5000,
      currency: "USD",
      durationMinutes: 60,
    });
    await connection.db.insert(pgSchema.orders).values({
      id: orderId,
      merchantId,
      customerUserId: userId,
      status: "CONFIRMED",
      currency: "USD",
      subtotalMinor: 5000,
      taxMinor: 0,
      totalMinor: 5000,
      placedAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    await connection.db.insert(pgSchema.orderLines).values({
      id: orderLineId,
      merchantId,
      orderId,
      listingId,
      variantId,
      mode: "SERVICE",
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    });
    await connection.db.insert(pgSchema.payments).values({
      id: paymentId,
      merchantId,
      orderId,
      provider: "STRIPE",
      providerRef: "pi_123",
      kind: "DEPOSIT_HOLD",
      amountMinor: 5000,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    await connection.db.insert(pgSchema.depositAuthorizations).values({
      id: depositId,
      merchantId,
      orderLineId,
      paymentId,
      amountMinor: 5000,
      currency: "USD",
      state: "AUTHORIZED",
      authorizedAt: new Date("2026-09-08T00:00:00.000Z"),
      expiresAt: new Date("2026-10-08T00:00:00.000Z"),
    });

    return connection;
  }

  it("transitions an expired HELD reservation to EXPIRED and releases its deposit authorization, and is idempotent on rerun", async () => {
    const connection = await freshConnection();
    try {
      await connection.db.insert(pgSchema.reservations).values({
        id: "018e6b3a-9c3e-7000-8000-0000000000eb",
        merchantId,
        orderLineId,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        endsAt: new Date("2026-10-01T10:00:00.000Z"),
        quantity: 1,
        state: "HELD",
        expiresAt: new Date("2026-10-01T08:15:00.000Z"),
        createdAt: new Date("2026-10-01T08:00:00.000Z"),
      });

      const first = await sweepExpiredHoldsPg(connection.pool, "2026-10-01T08:20:00.000Z");
      expect(first.expiredReservationIds).toEqual(["018e6b3a-9c3e-7000-8000-0000000000eb"]);
      expect(first.releasedDepositAuthorizationIds).toEqual([depositId]);

      const reservationRow = await connection.pool.query(
        'SELECT state, released_at FROM "reservations" WHERE id = $1',
        ["018e6b3a-9c3e-7000-8000-0000000000eb"],
      );
      expect(reservationRow.rows[0].state).toBe("EXPIRED");

      const depositRow = await connection.pool.query(
        'SELECT state FROM "deposit_authorizations" WHERE id = $1',
        [depositId],
      );
      expect(depositRow.rows[0].state).toBe("RELEASED");

      const second = await sweepExpiredHoldsPg(connection.pool, "2026-10-01T08:20:00.000Z");
      expect(second.expiredReservationIds).toEqual([]);
      expect(second.releasedDepositAuthorizationIds).toEqual([]);
    } finally {
      await connection.pool.end();
    }
  });

  it("docs/cards/D062.md — reports abandonment via the onAbandoned hook exactly when holds actually expired", async () => {
    const connection = await freshConnection();
    try {
      await connection.db.insert(pgSchema.reservations).values({
        id: "018e6b3a-9c3e-7000-8000-0000000000ee",
        merchantId,
        orderLineId,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        endsAt: new Date("2026-10-01T10:00:00.000Z"),
        quantity: 1,
        state: "HELD",
        expiresAt: new Date("2026-10-01T08:15:00.000Z"),
        createdAt: new Date("2026-10-01T08:00:00.000Z"),
      });

      const reports: unknown[] = [];
      const result = await sweepExpiredHoldsPg(connection.pool, "2026-10-01T08:20:00.000Z", (r) => reports.push(r));
      expect(reports).toEqual([result]);

      const secondReports: unknown[] = [];
      await sweepExpiredHoldsPg(connection.pool, "2026-10-01T08:20:00.000Z", (r) => secondReports.push(r));
      expect(secondReports).toEqual([]);
    } finally {
      await connection.pool.end();
    }
  });

  it("does not touch a HELD reservation that has not expired yet", async () => {
    const connection = await freshConnection();
    try {
      await connection.db.insert(pgSchema.reservations).values({
        id: "018e6b3a-9c3e-7000-8000-0000000000ec",
        merchantId,
        orderLineId,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        endsAt: new Date("2026-10-01T10:00:00.000Z"),
        quantity: 1,
        state: "HELD",
        expiresAt: new Date("2026-10-01T09:00:00.000Z"),
        createdAt: new Date("2026-10-01T08:00:00.000Z"),
      });

      const result = await sweepExpiredHoldsPg(connection.pool, "2026-10-01T08:20:00.000Z");
      expect(result.expiredReservationIds).toEqual([]);

      const row = await connection.pool.query('SELECT state FROM "reservations" WHERE id = $1', [
        "018e6b3a-9c3e-7000-8000-0000000000ec",
      ]);
      expect(row.rows[0].state).toBe("HELD");
    } finally {
      await connection.pool.end();
    }
  });

  it(
    "N real concurrent connections racing the same expired hold agree on exactly one winner",
    async () => {
      const connection = await freshConnection();
      try {
        await connection.db.insert(pgSchema.reservations).values({
          id: "018e6b3a-9c3e-7000-8000-0000000000ed",
          merchantId,
          orderLineId,
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt: new Date("2026-10-01T09:00:00.000Z"),
          endsAt: new Date("2026-10-01T10:00:00.000Z"),
          quantity: 1,
          state: "HELD",
          expiresAt: new Date("2026-10-01T08:15:00.000Z"),
          createdAt: new Date("2026-10-01T08:00:00.000Z"),
        });

        const connectionString = process.env.DATABASE_URL as string;
        const pools = Array.from({ length: 10 }, () => createPgConnection(connectionString));
        try {
          const results = await Promise.all(
            pools.map((p) => sweepExpiredHoldsPg(p.pool, "2026-10-01T08:20:00.000Z")),
          );

          const totalExpired = results.flatMap((r) => r.expiredReservationIds);
          const totalReleased = results.flatMap((r) => r.releasedDepositAuthorizationIds);

          expect(totalExpired).toEqual(["018e6b3a-9c3e-7000-8000-0000000000ed"]);
          expect(totalReleased).toEqual([depositId]);
        } finally {
          await Promise.all(pools.map((p) => p.pool.end()));
        }
      } finally {
        await connection.pool.end();
      }
    },
    30_000,
  );
});
