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
import { ListingRepository } from "./ListingRepository.js";
import { LocationRepository } from "./LocationRepository.js";
import { VariantRepository } from "./VariantRepository.js";
import { InventoryMovementRepository } from "./InventoryMovementRepository.js";

const workerUrl = fileURLToPath(
  new URL("./guardedDecrementWorker.mjs", import.meta.url),
);

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

describe("InventoryMovementRepository — I5 concurrency (guardedDecrement)", () => {
  // The worker threads import the *built* dist output (see
  // guardedDecrementWorker.mjs), not TS source — build @smb-os/domain and
  // @smb-os/db once up front so the concurrency run below exercises the
  // same guardedDecrement implementation this file's own imports use, not
  // a stale artifact from a previous session.
  beforeAll(() => {
    execFileSync(
      "pnpm",
      ["--filter", "@smb-os/domain", "--filter", "@smb-os/db", "build"],
      { cwd: fileURLToPath(new URL("../../../..", import.meta.url)), stdio: "inherit" },
    );
    expect(existsSync(fileURLToPath(new URL("../../dist/connection.js", import.meta.url)))).toBe(
      true,
    );
  }, 60_000);

  it(
    "N=50 real parallel worker-thread decrements: stock never negative, exactly N succeed",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "d040-guarded-decrement-"));
      const dbPath = join(tmpDir, "test.sqlite");

      const seedConnection: Connection = createConnection(dbPath);
      await runSqliteMigrations(seedConnection);

      const merchantId = generateUuidV7();
      const actorUserId = generateUuidV7();
      const ctx = createTenantContext(merchantId);

      await seedConnection.db.insert(sqliteSchema.merchants).values({
        id: merchantId,
        name: "Concurrency Merchant",
        slug: "concurrency-merchant",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      await seedConnection.db.insert(sqliteSchema.users).values({
        id: actorUserId,
        email: "concurrency@example.com",
        status: "ACTIVE",
        createdAt: "2026-09-08T00:00:00.000Z",
      });

      const listingId = new ListingRepository(seedConnection).create(ctx, {
        mode: "PRODUCT",
        name: "Concurrency Listing",
        slug: "concurrency-listing",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const variantId = new VariantRepository(seedConnection).create(ctx, {
        listingId,
        mode: "PRODUCT",
        sku: "CONC-SKU",
        name: "Concurrency Variant",
        priceMinor: 1000,
        currency: "USD",
      });
      const locationId = new LocationRepository(seedConnection).create(ctx, {
        name: "Main",
        timezone: "America/New_York",
      });

      // N=50 is the card's named concurrency figure — 50 units of real
      // stock. 5 extra attempts (55 total) oversubscribe it under the same
      // real parallel start, so the run proves both halves of the
      // invariant at once: exactly 50 succeed, and the 5 over-the-limit
      // attempts are rejected rather than silently taking stock negative.
      const STOCK = 50;
      const ATTEMPTS = 55;

      new InventoryMovementRepository(seedConnection).record(ctx, {
        variantId,
        locationId,
        kind: "RECEIPT",
        quantity: STOCK,
        occurredAt: "2026-09-08T00:00:00.000Z",
        actorUserId,
        note: "Seed stock for concurrency test",
      });
      seedConnection.sqlite.close();

      // Two SharedArrayBuffers act as a start gate: every worker increments
      // `ready` and then blocks on `go` via Atomics.wait. Only once all
      // ATTEMPTS workers have reported ready does the parent flip `go` and
      // wake them all at once — this is what makes the attempts genuinely
      // simultaneous rather than a fast sequential trickle.
      const readyFlag = new SharedArrayBuffer(4);
      const goFlag = new SharedArrayBuffer(4);
      const ready = new Int32Array(readyFlag);
      const go = new Int32Array(goFlag);

      const resultPromises = Array.from({ length: ATTEMPTS }, () =>
        runWorker({ dbPath, merchantId, variantId, locationId, actorUserId, readyFlag, goFlag }),
      );

      // Spinning up dozens of worker threads (each a fresh V8 isolate
      // loading a native addon) is itself slow on a modest machine — this
      // deadline bounds worker *startup*, not the guardedDecrement calls
      // themselves, which only run once every worker has already reported
      // ready.
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

      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      expect(succeeded).toHaveLength(STOCK);
      expect(failed).toHaveLength(ATTEMPTS - STOCK);
      for (const failure of failed) {
        expect(failure.name).toBe("InsufficientStockError");
      }

      const verifyConnection = createConnection(dbPath);
      const finalStock = new InventoryMovementRepository(verifyConnection).sumStock(ctx, variantId);
      expect(finalStock).toBe(0);
      expect(finalStock).toBeGreaterThanOrEqual(0);
      verifyConnection.sqlite.close();

      rmSync(tmpDir, { recursive: true, force: true });
    },
    90_000,
  );
});
