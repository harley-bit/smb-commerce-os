import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { LocationRepository } from "./LocationRepository.js";
import { ReservationRepository } from "./ReservationRepository.js";

const workerUrl = fileURLToPath(new URL("./reservationRaceWorker.mjs", import.meta.url));

interface WorkerResult {
  ok: boolean;
  id?: string;
  name?: string;
  message?: string;
}

function runWorker(workerData: Record<string, unknown>): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData });
    worker.once("message", (msg: WorkerResult) => resolve(msg));
    worker.once("error", reject);
  });
}

/**
 * D052 — the concurrency test harness itself. `docs/design/05` §"Concurrency
 * tests run real parallel transactions, not sequential calls with mocked
 * timing" and this card's security check ("a test that isn't actually
 * concurrent proves nothing") are both answered the same way D040 answered
 * them for inventory: `N` genuinely separate `worker_threads`, each its own
 * V8 isolate with its own `better-sqlite3` connection to the same on-disk
 * file, released simultaneously off a `SharedArrayBuffer` start-gate — not
 * `Promise.all` over same-thread calls, which would only ever exercise
 * Node's cooperative event loop, never SQLite's real locking behavior.
 *
 * The card's acceptance criterion ("harness demonstrably races — fails
 * without the fix") is proven directly by the first test below: running the
 * exact same harness against the unguarded `create()` write path lets `N`
 * real concurrent workers all successfully insert overlapping reservations
 * for the same resource — an actual, on-disk double-booking, not a
 * hypothetical one. The second test proves the harness is not rigged to
 * always fail: pointed at `createGuarded()` (D050), the identical race
 * yields exactly one winner.
 */
describe("ReservationRepository — concurrency harness (D052, real worker-thread race)", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@smb-os/domain", "--filter", "@smb-os/db", "build"], {
      cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
      stdio: "inherit",
    });
    expect(existsSync(fileURLToPath(new URL("../../dist/connection.js", import.meta.url)))).toBe(true);
  }, 60_000);

  const ATTEMPTS = 10;

  async function seed(): Promise<{
    tmpDir: string;
    dbPath: string;
    merchantId: string;
    resourceId: string;
  }> {
    const tmpDir = mkdtempSync(join(tmpdir(), "d052-reservation-race-"));
    const dbPath = join(tmpDir, "test.sqlite");

    const seedConnection: Connection = createConnection(dbPath);
    await runSqliteMigrations(seedConnection);

    const merchantId = generateUuidV7();
    const ctx = createTenantContext(merchantId);

    await seedConnection.db.insert(sqliteSchema.merchants).values({
      id: merchantId,
      name: "Race Merchant",
      slug: `race-merchant-${merchantId}`,
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    const locationId = new LocationRepository(seedConnection).create(ctx, {
      name: "Main",
      timezone: "America/New_York",
    });
    const resourceId = generateUuidV7();
    await seedConnection.db.insert(sqliteSchema.resources).values({
      id: resourceId,
      merchantId,
      locationId,
      kind: "STAFF",
      name: "Jane the instructor",
      capacity: 1,
    });

    seedConnection.sqlite.close();
    return { tmpDir, dbPath, merchantId, resourceId };
  }

  async function race(
    dbPath: string,
    merchantId: string,
    resourceId: string,
    guarded: boolean,
  ): Promise<WorkerResult[]> {
    const startsAt = "2026-10-01T09:00:00.000Z";
    const endsAt = "2026-10-01T10:00:00.000Z";

    const readyFlag = new SharedArrayBuffer(4);
    const goFlag = new SharedArrayBuffer(4);
    const ready = new Int32Array(readyFlag);
    const go = new Int32Array(goFlag);

    const resultPromises = Array.from({ length: ATTEMPTS }, () =>
      runWorker({
        dbPath,
        merchantId,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt,
        endsAt,
        guarded,
        readyFlag,
        goFlag,
      }),
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

    return Promise.all(resultPromises);
  }

  it(
    "the unguarded write path (create) lets real concurrent workers double-book the same resource — the harness demonstrably races without the fix",
    async () => {
      const { tmpDir, dbPath, merchantId, resourceId } = await seed();

      const results = await race(dbPath, merchantId, resourceId, false);
      const succeeded = results.filter((r) => r.ok);

      // If this ever reports exactly 1, the harness is not actually racing —
      // it would mean the workers ran sequentially, not concurrently.
      expect(succeeded.length).toBeGreaterThan(1);

      const verifyConnection = createConnection(dbPath);
      const ctx = createTenantContext(merchantId);
      const rows = new ReservationRepository(verifyConnection).findBlocking(
        ctx,
        "RESOURCE",
        resourceId,
        "2026-10-01T09:00:00.000Z",
        "2026-10-01T10:00:00.000Z",
        "2026-10-01T08:00:00.000Z",
      );
      expect(rows.length).toBe(succeeded.length);
      expect(rows.length).toBeGreaterThan(1);
      verifyConnection.sqlite.close();

      rmSync(tmpDir, { recursive: true, force: true });
    },
    90_000,
  );

  it(
    "the guarded write path (createGuarded) resolves the identical real concurrent race to exactly one winner",
    async () => {
      const { tmpDir, dbPath, merchantId, resourceId } = await seed();

      const results = await race(dbPath, merchantId, resourceId, true);
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(ATTEMPTS - 1);
      for (const failure of failed) {
        expect(failure.name).toBe("ReservationConflictError");
      }

      const verifyConnection = createConnection(dbPath);
      const ctx = createTenantContext(merchantId);
      const rows = new ReservationRepository(verifyConnection).findBlocking(
        ctx,
        "RESOURCE",
        resourceId,
        "2026-10-01T09:00:00.000Z",
        "2026-10-01T10:00:00.000Z",
        "2026-10-01T08:00:00.000Z",
      );
      expect(rows).toHaveLength(1);
      verifyConnection.sqlite.close();

      rmSync(tmpDir, { recursive: true, force: true });
    },
    90_000,
  );
});
