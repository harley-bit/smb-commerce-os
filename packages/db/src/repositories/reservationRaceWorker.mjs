// Plain JS, not TypeScript — see `guardedDecrementWorker.mjs` (D040) for why:
// worker_threads spawns this as a genuinely separate Node worker (its own
// thread, its own module graph, its own better-sqlite3 connection handle)
// rather than running through Vitest's transform pipeline, so it imports the
// *built* dist output instead of TS source. This is what makes this card's
// SQLite race a real multi-threaded, multi-connection contest against the
// same on-disk file, not a same-thread simulation of one.
import { parentPort, workerData } from "node:worker_threads";
import { createTenantContext } from "@smb-os/domain";
import { createConnection } from "../../dist/connection.js";
import { ReservationRepository } from "../../dist/repositories/ReservationRepository.js";

const { dbPath, merchantId, subjectType, subjectId, startsAt, endsAt, guarded, readyFlag, goFlag } =
  workerData;

const ready = new Int32Array(readyFlag);
const go = new Int32Array(goFlag);

const connection = createConnection(dbPath);
const repo = new ReservationRepository(connection);
const ctx = createTenantContext(merchantId);

// Signal readiness, then block until every worker has signaled and the
// parent releases them all at once — this is what forces the attempts to
// actually overlap instead of racing to be first to start (same start-gate
// pattern as D040's `guardedDecrementWorker.mjs`).
Atomics.add(ready, 0, 1);
Atomics.wait(go, 0, 0);

const input = {
  subjectType,
  subjectId,
  startsAt,
  endsAt,
  quantity: 1,
  state: "CONFIRMED",
  createdAt: new Date().toISOString(),
};

try {
  // `guarded: false` calls the plain `create()` (D049) — a raw insert with
  // no overlap check at all, the harness's deliberate "no fix" arm. `guarded:
  // true` calls `createGuarded()` (D050) — `BEGIN IMMEDIATE` before the
  // overlap check, the real production write path.
  const id = guarded ? repo.createGuarded(ctx, input) : repo.create(ctx, input);
  parentPort.postMessage({ ok: true, id });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    name: err instanceof Error ? err.name : "UnknownError",
    message: err instanceof Error ? err.message : String(err),
  });
} finally {
  connection.sqlite.close();
}
