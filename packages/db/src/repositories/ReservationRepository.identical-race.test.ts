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
 * D053 — Gate G3's core, never-waivable test: N=50 genuinely parallel
 * *identical* reservation requests (same subject, same exact interval) racing
 * the real production write path (`createGuarded`, D050's `BEGIN IMMEDIATE`
 * guard), proving exactly one wins at a concurrency level well past D052's
 * N=10 harness-validation runs. Same real-`worker_threads` / start-gate
 * mechanics as D052 — this card doesn't change how the race is generated, it
 * raises N and asserts on the production-only arm, since D052 already proved
 * the unguarded arm demonstrably fails.
 */
describe("ReservationRepository — N=50 identical-request race (D053, Gate G3)", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@smb-os/domain", "--filter", "@smb-os/db", "build"], {
      cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
      stdio: "inherit",
    });
    expect(existsSync(fileURLToPath(new URL("../../dist/connection.js", import.meta.url)))).toBe(true);
  }, 60_000);

  const ATTEMPTS = 50;

  async function seed(): Promise<{
    tmpDir: string;
    dbPath: string;
    merchantId: string;
    resourceId: string;
  }> {
    const tmpDir = mkdtempSync(join(tmpdir(), "d053-reservation-identical-race-"));
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

  it(
    "50 real concurrent workers submitting the identical reservation resolve to exactly one winner",
    async () => {
      const { tmpDir, dbPath, merchantId, resourceId } = await seed();
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
          guarded: true,
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

      const results = await Promise.all(resultPromises);
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
        startsAt,
        endsAt,
        "2026-10-01T08:00:00.000Z",
      );
      expect(rows).toHaveLength(1);
      verifyConnection.sqlite.close();

      rmSync(tmpDir, { recursive: true, force: true });
    },
    90_000,
  );
});
